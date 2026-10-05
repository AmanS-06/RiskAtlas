"""Single-origin production mode: the API process also serves the built web app (api/main.py, api/settings.py).

Everything here runs on a tiny temporary dist folder and the mock engine, so it needs neither node, nor the models,
nor a real web/dist. The one test that looks at a real build is skipped when web/dist is absent."""
import asyncio
import gzip
import json
import re

import pytest
from fastapi.testclient import TestClient

from api import settings
from api.main import MOCK_HEADER, create_app
from pipeline.settings import REPORTS_DIR, ROOT

EXAMPLE = json.loads((REPORTS_DIR / "example_prediction.json").read_text(encoding="utf-8"))
INDEX = '<!doctype html><html><head><title>dist-under-test</title></head><body><div id="root"></div></body></html>'
JS = "export const x = 'riskatlas';\n" * 200            # over the 1 KB gzip threshold
GLB = b"glTF" + b"\x02\x00\x00\x00" + bytes(range(256)) * 8
SECRET = "TOP-SECRET-OUTSIDE-DIST"
API_PATHS = ("/health", "/meta", "/predict", "/predict/fast")


def assert_error(r, status, code):
    assert r.status_code == status, r.text
    assert r.headers["content-type"].startswith("application/json"), r.headers["content-type"]
    body = r.json()
    assert set(body) == {"error"} and body["error"]["code"] == code, body


@pytest.fixture()
def dist(tmp_path):
    """tmp/dist is the web build; tmp/secret.txt sits next to it, outside, for the traversal tests."""
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "models3d").mkdir()
    (root / "index.html").write_bytes(INDEX.encode("utf-8"))
    (root / "assets" / "index-AbC123.js").write_bytes(JS.encode("utf-8"))
    (root / "assets" / "index-AbC123.css").write_bytes(("body{margin:0}\n" * 100).encode("utf-8"))
    (root / "models3d" / "heart.glb").write_bytes(GLB)
    (root / "models3d" / "LICENSE-models.md").write_bytes(b"# licences\n")
    (tmp_path / "secret.txt").write_bytes(SECRET.encode("utf-8"))
    return root


@pytest.fixture()
def clean_env(monkeypatch):
    for name in ("SERVE_WEB", "WEB_DIST"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.fixture()
def client(dist, clean_env):
    with TestClient(create_app(mock=True, web_dist=dist)) as c:
        yield c


def raw_get(app, path, method="GET"):
    """Call the ASGI app with a path exactly as given. Test clients normalise '..' away before the request is
    sent, a hostile client does not, so this is the way to prove the server itself refuses it."""
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
             "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "",
             "headers": [(b"host", b"testserver")], "client": ("127.0.0.1", 5000), "server": ("testserver", 80)}
    asyncio.run(app(scope, receive, send))
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, body


# ---- switching it on and off ------------------------------------------------------------------------------------

def test_off_by_default_and_the_api_is_untouched(clean_env):
    """No env, no argument: exactly the old behaviour, whether or not web/dist exists on this machine."""
    with TestClient(create_app(mock=True)) as c:
        assert c.get("/health").status_code == 200
        assert_error(c.get("/nope"), 404, "not_found")
        assert_error(c.get("/"), 404, "not_found")
        assert_error(c.get("/api/health"), 404, "not_found")   # no /api prefix without the web app
        assert_error(c.get("/predict"), 405, "method_not_allowed")


def test_env_vars_turn_it_on_and_off(dist, clean_env):
    clean_env.setenv("WEB_DIST", str(dist))
    with TestClient(create_app(mock=True)) as c:
        assert "dist-under-test" in c.get("/").text and c.get("/api/health").status_code == 200
    clean_env.setenv("SERVE_WEB", "0")                           # off beats a WEB_DIST value
    with TestClient(create_app(mock=True)) as c:
        assert_error(c.get("/"), 404, "not_found")
    clean_env.delenv("WEB_DIST")
    clean_env.setenv("SERVE_WEB", "1")                           # on, with the default folder (web/dist)
    assert settings.web_dist() == settings.DEFAULT_WEB_DIST


def test_web_dist_setting(dist, clean_env, tmp_path):
    assert settings.web_dist() is None
    assert settings.web_dist(auto=True) in (None, settings.DEFAULT_WEB_DIST)   # on only if web/dist/index.html exists
    clean_env.setenv("WEB_DIST", str(dist))
    assert settings.web_dist() == dist
    clean_env.setenv("SERVE_WEB", "off")
    assert settings.web_dist(auto=True) is None
    clean_env.delenv("WEB_DIST")
    clean_env.setenv("SERVE_WEB", "")
    empty = tmp_path / "empty"
    empty.mkdir()
    clean_env.setattr(settings, "DEFAULT_WEB_DIST", empty)
    assert settings.web_dist(auto=True) is None                  # nothing built there: stay API-only
    (empty / "index.html").write_bytes(INDEX.encode("utf-8"))
    assert settings.web_dist(auto=True) == empty and settings.web_dist() is None


def test_a_missing_build_is_a_warning_not_a_crash(tmp_path, caplog, clean_env):
    with TestClient(create_app(mock=True, web_dist=tmp_path / "not-built")) as c:
        assert c.get("/health").status_code == 200
        assert_error(c.get("/"), 404, "not_found")
    assert "web app not served" in caplog.text and "npm run build" in caplog.text


def test_the_openapi_schema_is_the_same_with_and_without_the_web_app(dist, clean_env):
    assert create_app(mock=True).openapi() == create_app(mock=True, web_dist=dist).openapi()


# ---- the API: root routes as before, /api/* the same ------------------------------------------------------------

def test_root_routes_still_work(client):
    assert client.get("/health").json()["status"] == "mock"
    assert client.get("/meta").json()["mock"] is True
    r = client.post("/predict", json=EXAMPLE["input"])
    assert r.status_code == 200 and r.headers[MOCK_HEADER] == "true" and r.headers["cache-control"] == "no-store"
    assert set(r.json()["targets"]) == {"CAD", "LAD", "LCX", "RCA"}
    r = client.post("/predict/fast", json=EXAMPLE["input"])
    assert r.status_code == 200 and "shap" not in r.json()["targets"]["CAD"]
    assert client.get("/docs").status_code == 200 and client.get("/openapi.json").status_code == 200


def test_api_prefix_gives_the_same_answers(client):
    for path in ("/health", "/meta"):
        a, b = client.get(path), client.get("/api" + path)
        assert b.status_code == 200 and b.json() == a.json() and b.headers[MOCK_HEADER] == "true", path
    for path in ("/predict", "/predict/fast"):
        a, b = client.post(path, json=EXAMPLE["input"]), client.post("/api" + path, json=EXAMPLE["input"])
        assert b.status_code == 200 and b.headers["cache-control"] == "no-store", path
        assert {**b.json(), "timing_ms": None} == {**a.json(), "timing_ms": None}, path


def test_api_errors_keep_the_json_envelope_under_the_prefix(client):
    for label in ("LAD", "Cath"):
        r = client.post("/api/predict", json={"age": 60, label: 1})
        assert_error(r, 422, "leakage")
    assert_error(client.post("/api/predict/fast", json={"dm": 7}), 422, "validation_error")
    assert_error(client.get("/api/predict"), 405, "method_not_allowed")        # a real route, wrong method
    assert_error(client.get("/predict/fast"), 405, "method_not_allowed")


@pytest.mark.parametrize("method,path", [("GET", "/api"), ("GET", "/api/"), ("GET", "/api/nope"), ("POST", "/api/nope"),
                                         ("GET", "/api/predict/nope"), ("GET", "/api/meta/x"), ("GET", "/api/index.html"),
                                         ("GET", "/api/assets/index-AbC123.js"), ("DELETE", "/api/health")])
def test_unknown_api_paths_are_a_json_404_never_the_page(client, method, path):
    r = client.request(method, path)
    if method == "DELETE":                       # a real route, wrong method
        return assert_error(r, 405, "method_not_allowed")
    assert_error(r, 404, "not_found")
    assert "dist-under-test" not in r.text


def test_the_page_never_answers_a_post_it_does_not_know(client):
    assert_error(client.post("/nope"), 404, "not_found")
    assert_error(client.post("/"), 404, "not_found")


def test_cors_stays_configurable(dist, clean_env):
    clean_env.setenv("API_CORS_ORIGINS", "https://demo.example.org")
    with TestClient(create_app(mock=True, web_dist=dist)) as c:
        ok = c.get("/api/health", headers={"Origin": "https://demo.example.org"})
        other = c.get("/api/health", headers={"Origin": "https://evil.example.org"})
    assert ok.headers["access-control-allow-origin"] == "https://demo.example.org"
    assert "access-control-allow-origin" not in other.headers


# ---- the web app ------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("path", ["/", "/index.html", "/some/deep/link", "/predict-now", "/assets", "/models3d/", "/.hidden"])
def test_spa_fallback_returns_index_html(client, path):
    r = client.get(path)
    assert r.status_code == 200 and r.text == INDEX, path
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("path", ["/assets/missing.js", "/models3d/other.glb", "/favicon.ico", "/robots.txt"])
def test_a_missing_file_is_a_404_not_the_page(client, path):
    assert_error(client.get(path), 404, "not_found")


@pytest.mark.parametrize("path,mime", [("/assets/index-AbC123.js", "text/javascript"), ("/assets/index-AbC123.css", "text/css"),
                                       ("/models3d/heart.glb", "model/gltf-binary"), ("/models3d/LICENSE-models.md", "text/markdown"),
                                       ("/", "text/html")])
def test_mime_types(client, path, mime):
    r = client.get(path)
    assert r.status_code == 200 and r.headers["content-type"].split(";")[0] == mime, r.headers["content-type"]


def test_mime_table_has_glb_even_without_a_system_mime_file():
    import mimetypes
    assert mimetypes.guess_type("heart.glb")[0] == "model/gltf-binary"
    assert mimetypes.guess_type("a.js")[0] == "text/javascript" and mimetypes.guess_type("a.svg")[0] == "image/svg+xml"


def test_cache_headers(client):
    assert client.get("/assets/index-AbC123.js").headers["cache-control"] == "public, max-age=31536000, immutable"
    assert client.get("/assets/index-AbC123.css").headers["cache-control"] == "public, max-age=31536000, immutable"
    assert client.get("/models3d/heart.glb").headers["cache-control"] == "public, max-age=3600"
    assert client.get("/").headers["cache-control"] == "no-cache"
    # API answers keep their own headers
    assert client.post("/api/predict/fast", json={"age": 50}).headers["cache-control"] == "no-store"
    assert "cache-control" not in client.get("/api/health").headers


def test_conditional_requests_are_answered_with_304(client):
    first = client.get("/models3d/heart.glb")
    etag = first.headers["etag"]
    again = client.get("/models3d/heart.glb", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b"" and again.headers["cache-control"] == "public, max-age=3600"
    assert client.get("/", headers={"If-None-Match": client.get("/").headers["etag"]}).status_code == 304


@pytest.mark.parametrize("path,length", [("/", len(INDEX)), ("/assets/index-AbC123.js", len(JS)), ("/models3d/heart.glb", len(GLB))])
def test_head_requests(client, path, length):
    head, get = client.head(path), client.get(path)
    assert head.status_code == 200 and head.content == b""
    assert head.headers["content-type"] == get.headers["content-type"]
    assert head.headers["cache-control"] == get.headers["cache-control"]
    assert head.headers.get("content-length") == str(length) or "content-encoding" in head.headers
    assert client.head("/some/deep/link").status_code == 200
    assert client.head("/api/nope").status_code == 404


def test_range_requests_work_for_the_3d_model(client):
    for encoding in ("identity", "gzip"):        # a partial answer must never be gzipped
        r = client.get("/models3d/heart.glb", headers={"Range": "bytes=0-3", "Accept-Encoding": encoding})
        assert r.status_code == 206 and r.content == b"glTF" and "content-encoding" not in r.headers, encoding


def test_gzip_for_text_when_the_browser_accepts_it(dist, clean_env):
    with TestClient(create_app(mock=True, web_dist=dist)) as c:
        r = c.get("/assets/index-AbC123.js", headers={"Accept-Encoding": "gzip"})
        assert r.headers["content-encoding"] == "gzip" and "Accept-Encoding" in r.headers["vary"] and r.text == JS
        plain = c.get("/assets/index-AbC123.js", headers={"Accept-Encoding": "identity"})
        assert "content-encoding" not in plain.headers and plain.text == JS
        small = c.get("/api/health", headers={"Accept-Encoding": "gzip"})
        assert "content-encoding" not in small.headers and small.json()["status"] == "mock"
        meta = c.get("/api/meta", headers={"Accept-Encoding": "gzip"})
        assert meta.headers["content-encoding"] == "gzip" and meta.json()["mock"] is True
    assert len(gzip.compress(JS.encode())) < len(JS) / 4


# ---- no path traversal ------------------------------------------------------------------------------------------

TRAVERSAL = ["/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt", "/..%5csecret.txt", "/assets/../../secret.txt",
             "/assets/..%2f..%2fsecret.txt", "/models3d/%2e%2e%2f%2e%2e%2fsecret.txt", "//secret.txt", "/%2fsecret.txt",
             "/....//secret.txt", "/assets/%00../secret.txt", "/..%252fsecret.txt"]


@pytest.mark.parametrize("path", TRAVERSAL)
def test_no_path_traversal_through_the_test_client(client, path):
    r = client.get(path)
    assert SECRET not in r.text and r.status_code in (200, 404), (path, r.status_code)
    if r.status_code == 200:
        assert r.text == INDEX               # only ever the page, never a file outside dist


@pytest.mark.parametrize("path", TRAVERSAL + ["/../../../../etc/passwd", "/assets/../../../etc/passwd", "/models3d/../../secret.txt"])
def test_no_path_traversal_at_the_asgi_level(dist, clean_env, path):
    """Paths exactly as a hostile client could send them, without a client library tidying them first."""
    app = create_app(mock=True, web_dist=dist)
    status, body = raw_get(app, path)
    assert SECRET.encode() not in body and b"root:" not in body, path
    assert status in (200, 404), (path, status)
    if status == 200:
        assert body.decode() == INDEX


def test_a_symlink_out_of_dist_is_not_followed(dist, tmp_path, clean_env):
    try:
        (dist / "assets" / "leak.txt").symlink_to(tmp_path / "secret.txt")
    except (OSError, NotImplementedError):  # Windows needs a privilege (or Developer Mode) to create symlinks
        pytest.skip("this account cannot create symlinks")
    with TestClient(create_app(mock=True, web_dist=dist)) as c:
        r = c.get("/assets/leak.txt")
    assert SECRET not in r.text and r.status_code == 404


# ---- a real build, if there is one ------------------------------------------------------------------------------

REAL_DIST = ROOT / "web" / "dist"


@pytest.mark.skipif(not (REAL_DIST / "index.html").exists(), reason="web/dist not built (cd web && npm run build)")
def test_every_file_the_real_build_refers_to_is_served(clean_env):
    html = (REAL_DIST / "index.html").read_text(encoding="utf-8")
    refs = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
    assert refs, "index.html refers to no hashed asset"
    with TestClient(create_app(mock=True, web_dist=REAL_DIST)) as c:
        for ref in refs + ["/models3d/heart.glb", "/models3d/heart_lite.glb"]:
            r = c.get(ref, headers={"Accept-Encoding": "identity"})
            assert r.status_code == 200, ref
            assert r.headers["content-type"].split(";")[0] in ("text/javascript", "text/css", "model/gltf-binary"), ref
        assert (REAL_DIST / "models3d" / "heart.glb").stat().st_size == len(c.get("/models3d/heart.glb", headers={"Accept-Encoding": "identity"}).content)
        assert c.get("/").text == html
