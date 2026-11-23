#!/usr/bin/env python3
"""Lista de lojas novas (CNAE 4744, material de construção) a partir dos dados abertos da Receita Federal.
Roda no GitHub (Actions). Grava lojas_novas.json e lojas_novas_status.json na raiz do repositório."""
import datetime, hashlib, io, json, os, sys, time, urllib.request, urllib.error, zipfile, traceback

HOJE = datetime.date.today()
JANELA = max(240, (HOJE - HOJE.replace(month=1, day=1)).days)   # dias: tudo que abriu desde 1º de janeiro do ano (mínimo 8 meses)
CORTE = (HOJE - datetime.timedelta(days=JANELA)).strftime('%Y%m%d')
SAIDA = os.environ.get('SAIDA', '.')
STATUS = {'rodou_em': HOJE.isoformat(), 'ok': False, 'tentativas': [], 'erro': ''}

def meses():
    d = HOJE.replace(day=1)
    for _ in range(4):
        yield d.strftime('%Y-%m')
        d = (d - datetime.timedelta(days=1)).replace(day=1)

def _auth(tok):
    import base64
    return {'Authorization': 'Basic ' + base64.b64encode((tok + ':').encode()).decode()}

def bases(mes):
    """(endereço base, cabeçalhos). A Receita mudou de endereço mais de uma vez: tenta os conhecidos."""
    W = 'https://arquivos.receitafederal.gov.br/public.php/webdav'
    out = []
    for tok in ('YggdBLfdninEJX9', 'gn672Ad4CF8N6TK'):
        for raiz in ('', '/Dados/Cadastros/CNPJ'):
            out.append((W + raiz + '/' + mes + '/', _auth(tok)))
    out.append(('https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/%s/' % mes, {}))
    out.append(('https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/%s/' % mes, {}))
    return out

def head_ok(url, hdr):
    try:
        h = {'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-3'}; h.update(hdr)
        r = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(r, timeout=60) as x:
            ok = x.read(2) == b'PK'
            if not ok:
                STATUS['tentativas'].append('%s -> resposta que não é arquivo zip' % url)
            return ok
    except Exception as e:
        STATUS['tentativas'].append('%s -> %s' % (url, e))
        return False

def baixa(url, dest, hdr):
    for t in range(3):
        try:
            h = {'User-Agent': 'Mozilla/5.0'}; h.update(hdr)
            r = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(r, timeout=300) as x, open(dest, 'wb') as f:
                while True:
                    b = x.read(1 << 20)
                    if not b: break
                    f.write(b)
            return
        except Exception as e:
            STATUS['tentativas'].append('baixa %s (%d): %s' % (url, t + 1, e))
            time.sleep(10)
    raise RuntimeError('não consegui baixar ' + url)

def linhas(path):
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            with z.open(n) as f:
                for raw in io.TextIOWrapper(f, encoding='latin-1', newline=''):
                    yield raw.rstrip('\r\n').strip('"').split('";"')

def main():
    base = None; mes = None; HD = {}
    for m in meses():
        for b, hd in bases(m):
            if head_ok(b + 'Estabelecimentos0.zip', hd):
                base, mes, HD = b, m, hd; break
        if base: break
    if not base:
        raise RuntimeError('não achei os arquivos da Receita (endereço pode ter mudado)')
    STATUS['mes_base'] = mes
    os.makedirs('tmp', exist_ok=True)
    MUN = {}
    try:
        baixa(base + 'Municipios.zip', 'tmp/mun.zip', HD)
        MUN = {l[0]: l[1] for l in linhas('tmp/mun.zip') if len(l) >= 2}
    except Exception as e:
        STATUS['tentativas'].append('sem Municipios.zip: %s' % e)
    try:
        HS = set(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'clientes_hash.json')))['h'])
    except Exception:
        HS = set()
    fechados = {}
    achados = {}
    for i in range(10):
        p = 'tmp/est%d.zip' % i
        baixa(base + 'Estabelecimentos%d.zip' % i, p, HD)
        for c in linhas(p):
            if HS and len(c) >= 21 and c[5] != '02':
                h = hashlib.sha256(('mm1:' + c[0] + c[1] + c[2]).encode()).hexdigest()[:20]
                if h in HS:
                    fechados[h] = [h, c[5], c[6], c[7]]
            if len(c) < 21 or c[5] != '02' or not c[11].startswith('4744') or c[10] < CORTE:
                continue
            cnpj = c[0] + c[1] + c[2]
            tel = (c[21] + c[22]).strip()
            fim = ' '.join(x for x in [c[13], c[14], c[15]] if x).strip()
            achados[cnpj] = {'b': c[0], 'f': c[4], 'a': c[10], 'c': MUN.get(c[20], c[20]), 'u': c[19], 'bai': c[17], 'e': fim, 't': tel, 'n': c[11], 'cep': c[18]}
        os.remove(p)
    basicos = {v['b'] for v in achados.values()}
    razao = {}
    for i in range(10):
        p = 'tmp/emp%d.zip' % i
        baixa(base + 'Empresas%d.zip' % i, p, HD)
        for c in linhas(p):
            if c and c[0] in basicos:
                razao[c[0]] = c[1]
        os.remove(p)
    itens = []
    for cnpj, v in achados.items():
        nome = (v['f'] or razao.get(v['b'], '') or 'CNPJ ' + cnpj).title()
        itens.append([cnpj, nome, '%s-%s-%s' % (v['a'][:4], v['a'][4:6], v['a'][6:8]), v['c'], v['u'], v['bai'].title(), v['e'].title(), v['t'], v['n'], v['cep']])
    itens.sort(key=lambda x: x[2], reverse=True)
    json.dump({'gerado': HOJE.isoformat(), 'mes_base': mes, 'janela_dias': JANELA, 'total': len(itens), 'itens': itens},
              open(os.path.join(SAIDA, 'lojas_novas.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump({'gerado': HOJE.isoformat(), 'mes_base': mes, 'total': len(fechados), 'itens': sorted(fechados.values())},
              open(os.path.join(SAIDA, 'cnpjs_fechados.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    STATUS['ok'] = True; STATUS['total'] = len(itens); STATUS['fechados'] = len(fechados)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        STATUS['erro'] = '%s: %s' % (type(e).__name__, e)
        traceback.print_exc()
    json.dump(STATUS, open(os.path.join(SAIDA, 'lojas_novas_status.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
