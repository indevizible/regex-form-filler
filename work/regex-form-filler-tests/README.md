# Developer tests and fixtures

Run from the repository root with Node.js 22+ and Python 3.9+:

```sh
node --test work/regex-form-filler-tests/*.test.mjs
python3 work/regex-form-filler-tests/preview-server.py --self-test
python3 work/regex-form-filler-tests/preview-server.py --port 8767
```

The local preview uses the actual extension UI with mock Chrome APIs. Open:

- Popup: http://127.0.0.1:8767/outputs/regex-form-filler/popup.html
- Form controls: http://127.0.0.1:8767/work/regex-form-filler-tests/fixture.html
- Dates: http://127.0.0.1:8767/work/regex-form-filler-tests/date-fixture.html
- Shortcut Next: http://127.0.0.1:8767/work/regex-form-filler-tests/shortcut-next-fixture.html
- Sequential files: http://127.0.0.1:8767/work/regex-form-filler-tests/file-fixture.html

Use synthetic data only. TEST-ONLY.pdf is a tiny synthetic document. Fixtures do not load personal files automatically. Test-only Chrome adapters and localhost support are not included in the extension ZIP.

The unit tests use Node workers and focused DOM/browser doubles. Passing them or viewing the preview does not establish installed-extension shortcuts, permissions, service-worker lifecycle or compatibility with the current Google Forms UI. Verify those separately in a practice form you control. Historical local logs are not part of this repository.
