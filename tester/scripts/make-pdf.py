import json
import markdown
import re
import pathlib

src = pathlib.Path(r'C:\Users\siddh\Desktop\FlytBase Hackathon\SUBMISSION\EVALUATION.md')
out_html = pathlib.Path(r'C:\Users\siddh\Desktop\FlytBase Hackathon\SUBMISSION\EVALUATION.html')
out_pdf = pathlib.Path(r'C:\Users\siddh\Desktop\FlytBase Hackathon\SUBMISSION\EVALUATION.pdf')

md = src.read_text(encoding='utf-8')

# Unwrap <details> blocks so everything is visible in print.
md = re.sub(r'<details><summary>(.*?)</summary>', r'<h3>\1</h3>', md, flags=re.S)
md = md.replace('</details>', '')

body = markdown.markdown(md, extensions=['tables', 'fenced_code'])

# Table of metadata lines: bold the leading label
html = f"""<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page {{ size: A4; margin: 16mm 14mm; }}
  body {{ font: 10.5pt/1.55 'Segoe UI', Inter, sans-serif; color: #1a1a1e; }}
  h1 {{ font-size: 21pt; margin: 0 0 4pt; color: #10131a; }}
  h2 {{ font-size: 14pt; margin: 20pt 0 6pt; padding-bottom: 3pt; border-bottom: 2px solid #2c4178; color: #2c4178; }}
  h3 {{ font-size: 12pt; margin: 14pt 0 5pt; color: #10131a; }}
  p {{ margin: 5pt 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; page-break-inside: avoid; }}
  th, td {{ border: 0.6pt solid #c8cad2; padding: 4pt 7pt; text-align: left; vertical-align: top; }}
  th {{ background: #eef1f8; }}
  code {{ background: #f0f1f4; padding: 0.5pt 3pt; border-radius: 3px; font-size: 9pt; }}
  pre {{ background: #f6f7f9; border: 0.6pt solid #dfe1e7; padding: 8pt; border-radius: 5px; font-size: 8.5pt; white-space: pre-wrap; }}
  a {{ color: #2c4178; text-decoration: none; }}
  hr {{ border: none; border-top: 1px solid #d8dae1; margin: 14pt 0; }}
  li {{ margin: 2pt 0; }}
  strong {{ color: #10131a; }}
  ul details, ul {{ overflow-wrap: anywhere; }}
</style></head><body>
{body}
</body></html>"""

out_html.write_text(html, encoding='utf-8')
print('html written', out_html.resolve())
