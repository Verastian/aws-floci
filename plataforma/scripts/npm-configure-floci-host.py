#!/usr/bin/env python3
"""
Crea (o actualiza, si ya existe) el Proxy Host de nginx-proxy-manager que expone
Floci publicamente de forma acotada: solo sitios S3 con hosting estatico
(/site/<bucket>/...) y rutas de API Gateway (/restapis/...) -- nunca el puerto
4566 completo. Ver proyectos/quiz/docs/GUIA-SERVICIOS-AVANZADOS.md seccion 1.

Pensado para correr DENTRO del VPS (usa http://127.0.0.1:<NPM_API_PORT>/api).
No guarda ni loguea las credenciales: se leen de variables de entorno.

Uso:
  NPM_EMAIL=... NPM_PASS=... NPM_API_PORT=32771 FLOCI_PUBLIC_DOMAIN=floci.devera.cloud \
    python3 npm-configure-floci-host.py

NPM_API_PORT es el puerto publicado en el host para el puerto 81 del contenedor
de nginx-proxy-manager -- puede cambiar si el contenedor se recrea; confirmar
con `docker port <contenedor-npm>` antes de correr esto.
"""
import json
import os
import sys
import urllib.error
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ADVANCED_CONF_PATH = os.path.join(SCRIPT_DIR, "..", "nginx", "floci-advanced.conf")

DOMAIN = os.environ.get("FLOCI_PUBLIC_DOMAIN")
NPM_API_PORT = os.environ.get("NPM_API_PORT")
EMAIL = os.environ.get("NPM_EMAIL")
PASSWORD = os.environ.get("NPM_PASS")
FLOCI_CONTAINER = os.environ.get("FLOCI_CONTAINER_NAME", "floci-floci-1")

for name, val in [("FLOCI_PUBLIC_DOMAIN", DOMAIN), ("NPM_API_PORT", NPM_API_PORT),
                   ("NPM_EMAIL", EMAIL), ("NPM_PASS", PASSWORD)]:
    if not val:
        print(f"Falta la variable de entorno {name}", file=sys.stderr)
        sys.exit(1)

NPM_BASE = f"http://127.0.0.1:{NPM_API_PORT}/api"


def call(method, path, token=None, body=None):
    url = NPM_BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def main():
    status, res = call("POST", "/tokens", body={"identity": EMAIL, "secret": PASSWORD})
    if status != 200:
        print("Login fallo:", status, res, file=sys.stderr)
        sys.exit(1)
    token = res["token"]
    print("login OK")

    status, certs = call("GET", "/nginx/certificates", token=token)
    cert_id = next((c["id"] for c in certs if DOMAIN in c.get("domain_names", [])), None)

    if cert_id is None:
        status, res = call("POST", "/nginx/certificates", token=token, body={
            "provider": "letsencrypt",
            "domain_names": [DOMAIN],
            "meta": {"dns_challenge": False},
        })
        if status not in (200, 201):
            print("Crear certificado fallo:", status, json.dumps(res, indent=2), file=sys.stderr)
            sys.exit(1)
        cert_id = res["id"]
        print("certificado Let's Encrypt emitido, id=", cert_id)
    else:
        print("certificado existente reutilizado, id=", cert_id)

    with open(ADVANCED_CONF_PATH) as f:
        advanced_config = f.read()

    status, hosts = call("GET", "/nginx/proxy-hosts", token=token)
    existing_id = next((h["id"] for h in hosts if DOMAIN in h.get("domain_names", [])), None)

    payload = {
        "domain_names": [DOMAIN],
        "forward_scheme": "http",
        "forward_host": FLOCI_CONTAINER,
        # Puerto "trampa": nunca corre nada ahi. Cualquier ruta no cubierta por
        # los location de floci-advanced.conf cae aca y da 502, en vez de
        # reenviar silenciosamente el trafico crudo a Floci en el puerto 4566.
        "forward_port": 65535,
        "access_list_id": "0",
        "certificate_id": cert_id,
        "ssl_forced": True,
        "http2_support": True,
        "block_exploits": False,
        "caching_enabled": False,
        "allow_websocket_upgrade": False,
        "hsts_enabled": False,
        "hsts_subdomains": False,
        "advanced_config": advanced_config,
        "meta": {},
        "locations": [],
    }

    if existing_id:
        status, res = call("PUT", f"/nginx/proxy-hosts/{existing_id}", token=token, body=payload)
        print("actualizar proxy host:", status)
    else:
        status, res = call("POST", "/nginx/proxy-hosts", token=token, body=payload)
        print("crear proxy host:", status)

    if status not in (200, 201):
        print(json.dumps(res, indent=2), file=sys.stderr)
        sys.exit(1)
    print(f"listo: https://{DOMAIN}/ (id={res['id']})")


if __name__ == "__main__":
    main()
