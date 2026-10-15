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

The 1.6.1 popup preview retains the preset behavior introduced in 1.6.0; 1.6.1 changes only the icons. It uses the shipping preset helpers and an isolated synthetic localStorage key. Old preview rules appear as “ค่าเริ่มต้น” until the first mutation. Selection survives reload; preview runs use the selected preset. Next preferences remain global. Reset clears only synthetic rules, presets and preferences, retaining IndexedDB copies as before.

The parent reported that the Opera local preview preserved legacy rules and TEST-ONLY.pdf, cloned presets, guarded dirty rule edits, changed only copied rules, renamed presets and persisted selection across reload. This does not establish installed-extension behavior.

For the remaining browser verification: check active-only JSON export and visible feedback for blank/duplicate names and successful renames. Open inline deletion and check its named warning, **ยืนยันลบชุด** and **ยกเลิก** buttons; editing/switching must stay disabled until cancellation or confirmation. Cancel, switch presets, and verify that an old confirmation cannot delete the new selection. Confirm deletion and try deleting the last preset. Open a second preview window and change its saved preset while the first is confirming deletion; the first must hide confirmation, preserve drafts and keep the reopen warning visible. Use TEST-ONLY.pdf to check shared-reference retention and final-reference cleanup. These remaining scenarios still require a browser run; this checklist is not an acceptance record.

The unit tests use Node workers and focused DOM/browser doubles. Passing them or viewing the preview does not establish installed-extension shortcuts, permissions, service-worker lifecycle or compatibility with the current Google Forms UI. Verify those separately in a practice form you control. Historical local logs are not part of this repository.
