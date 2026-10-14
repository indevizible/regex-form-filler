#!/usr/bin/env python3
"""Serve the real popup with test-only Chrome APIs. Run from the workspace root."""
import argparse
import io
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

POPUP = '/outputs/regex-form-filler/popup.html'
MOCK = '<script src="/work/regex-form-filler-tests/preview-chrome.js"></script>\n  '
ENTRY = '<script type="module" src="popup.js"></script>'
PICKER = '/work/regex-form-filler-tests/file-picker.html'


def inject_preview(source):
    if source.count(ENTRY) != 1:
        raise ValueError('Expected one production popup.js entry; update the preview injector')
    return source.replace(ENTRY, MOCK + ENTRY).encode('utf-8')


class PreviewHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # A same-origin /picker fixture; production URL allowlist is unchanged.
        return super().translate_path(PICKER if urlsplit(path).path == '/picker' else path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        if urlsplit(self.path).path != POPUP:
            return super().send_head()
        body = inject_preview(Path(self.translate_path(POPUP)).read_text(encoding='utf-8'))
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return io.BytesIO(body)


def self_test():
    source = Path(POPUP.lstrip('/')).read_text(encoding='utf-8')
    result = inject_preview(source).decode('utf-8')
    assert result.replace(MOCK, '', 1) == source
    assert result.index(MOCK) < result.index(ENTRY)
    assert Path('work/regex-form-filler-tests/preview-chrome.js').is_file()
    try:
        inject_preview('<html>No module</html>')
    except ValueError:
        pass
    else:
        raise AssertionError('Missing production module must fail clearly')
    # Exercise the shared header path without a server, socket or browser.
    handler = object.__new__(PreviewHandler)
    handler.request_version = 'HTTP/1.1'
    handler.wfile = io.BytesIO()
    handler.end_headers()
    assert b'Cache-Control: no-store' in handler.wfile.getvalue()
    for filename in ['shortcut-next-fixture.html', 'shortcut-next-fixture.js', 'date-fixture.html', 'file-fixture.html', 'file-fixture.js', 'file-picker.html', 'file-picker.js', 'TEST-ONLY.pdf']:
        assert Path('work/regex-form-filler-tests', filename).is_file()
    handler.directory = str(Path.cwd())
    assert Path(handler.translate_path('/picker?synthetic=1')).resolve() == Path(PICKER.lstrip('/')).resolve()
    assert 'indexedDB =' not in Path('work/regex-form-filler-tests/preview-chrome.js').read_text()
    assert 'indexedDB.open(' in Path('outputs/regex-form-filler/file-store.js').read_text()
    print('PASS: production HTML preserved; mock before popup.js; missing entry rejected; no-store headers; navigation/date/file fixtures present; same-origin /picker route; shipping IndexedDB unmocked (browser run still required)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        print(f'Test preview: http://127.0.0.1:{args.port}{POPUP}', flush=True)
        ThreadingHTTPServer(('127.0.0.1', args.port), PreviewHandler).serve_forever()
