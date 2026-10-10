#!/usr/bin/env python3
"""Zero-dependency REST and MCP inventory server used by the episode proof."""
from __future__ import annotations
import argparse, json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

INVENTORY={
    'GPU-01': {'sku':'GPU-01','name':'Edge GPU','available':7,'warehouse':'MEX-1'},
    'SSD-02': {'sku':'SSD-02','name':'NVMe SSD','available':42,'warehouse':'GDL-2'},
}
TOOL={'name':'inventory_lookup','description':'Return current stock for one known SKU. Read only.',
      'inputSchema':{'type':'object','properties':{'sku':{'type':'string','pattern':'^[A-Z]{3}-[0-9]{2}$'}},'required':['sku'],'additionalProperties':False}}

def lookup(arguments):
    if not isinstance(arguments,dict) or set(arguments)!= {'sku'} or not isinstance(arguments.get('sku'),str):
        raise ValueError('invalid arguments: expected exactly one string sku')
    sku=arguments['sku']
    if sku not in INVENTORY: raise ValueError('unknown sku')
    return INVENTORY[sku]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed=urlparse(self.path)
        if parsed.path!='/inventory': return self.reply(404,{'error':'not found'})
        sku=parse_qs(parsed.query).get('sku',[None])[0]
        if sku not in INVENTORY: return self.reply(400,{'error':'unknown or missing sku'})
        return self.reply(200,INVENTORY[sku])
    def reply(self,status,payload):
        body=json.dumps(payload,separators=(',',':')).encode(); self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self,*_): pass

def mcp_result(message):
    method=message.get('method'); request_id=message.get('id')
    if method=='initialize':
        return {'jsonrpc':'2.0','id':request_id,'result':{'protocolVersion':'2025-11-25','capabilities':{'tools':{'listChanged':False}},'serverInfo':{'name':'inventory-proof','version':'1.0.0'}}}
    if method=='tools/list': return {'jsonrpc':'2.0','id':request_id,'result':{'tools':[TOOL]}}
    if method=='tools/call':
        try:
            params=message.get('params') or {}
            if params.get('name')!='inventory_lookup': raise ValueError('unknown tool')
            value=lookup(params.get('arguments'))
            return {'jsonrpc':'2.0','id':request_id,'result':{'content':[{'type':'text','text':json.dumps(value,separators=(',',':'))}],'structuredContent':value,'isError':False}}
        except ValueError as exc:
            return {'jsonrpc':'2.0','id':request_id,'result':{'content':[{'type':'text','text':str(exc)}],'isError':True}}
    return None

def run_mcp():
    for line in sys.stdin:
        message=json.loads(line); response=mcp_result(message)
        if response is not None: print(json.dumps(response,separators=(',',':')),flush=True)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--mode',choices=('mcp','rest'),required=True); parser.add_argument('--port',type=int,default=8765); args=parser.parse_args()
    if args.mode=='mcp': run_mcp()
    else: ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
if __name__=='__main__': main()
