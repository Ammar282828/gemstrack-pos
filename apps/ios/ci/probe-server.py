# Serves probe.html to the simulator and writes what the page reports (POST /<name>) to <name>.txt.
import http.server, os, sys

OUT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        name = os.path.basename(self.path.strip('/')) or 'report'
        with open(os.path.join(OUT, name + '.txt'), 'ab') as f:
            f.write(body + b'\n')
        self.send_response(204)
        self.end_headers()

http.server.ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever()
