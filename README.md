# Rules Hub Standalone

## SIEM manager archive source

Set `SIEM_MANAGERS_DIR` to the directory where manager backup archives are written.

Ubuntu production:

```bash
SIEM_MANAGERS_DIR=/opt/mercure/siem-managers
```

Windows/local testing:

```powershell
SIEM_MANAGERS_DIR=C:\Users\MohamedHajji\Downloads\siem-managers
```

The app scans every `.tar.gz` or `.tgz` file in that directory, reads XML files under archive `rules/` and `decoders/` folders, and refreshes the dashboard from those files. The UI refresh button reloads immediately, and the browser also refreshes the source once per hour while open.
