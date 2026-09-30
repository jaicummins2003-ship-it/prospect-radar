import json,base64,re,os
srv=open('src/server.js').read()
html=open('src/app.html').read()
icon=base64.b64encode(open('src/icon.png','rb').read()).decode()
out=srv.replace('__APP_HTML__',json.dumps(html)).replace('__ICON_B64__',json.dumps(icon))
os.makedirs('dist',exist_ok=True); os.makedirs('test',exist_ok=True)
os.makedirs('test',exist_ok=True); open('test/lib.mjs','w').write(out)
open('dist/worker.js','w').write(re.sub(r'^export function','function',out,flags=re.M))
print(len(out)//1024,'KB')
