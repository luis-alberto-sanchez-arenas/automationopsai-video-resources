#!/usr/bin/env python3
"""Execute the same inventory lookup through REST and an MCP stdio session."""
from __future__ import annotations
import json, statistics, subprocess, sys, threading, time, urllib.error, urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT)); from server import Handler

def rest_get(sku):
    started=time.perf_counter_ns()
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:8765/inventory?sku={sku}',timeout=2) as response:
            return response.status,json.loads(response.read()),(time.perf_counter_ns()-started)/1e6
    except urllib.error.HTTPError as exc:
        return exc.code,json.loads(exc.read()),(time.perf_counter_ns()-started)/1e6

class Mcp:
    def __init__(self):
        self.process=subprocess.Popen([sys.executable,str(ROOT/'server.py'),'--mode','mcp'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1); self.counter=0
    def request(self,method,params=None):
        self.counter+=1; message={'jsonrpc':'2.0','id':self.counter,'method':method}
        if params is not None: message['params']=params
        started=time.perf_counter_ns(); self.process.stdin.write(json.dumps(message)+'\n'); self.process.stdin.flush(); response=json.loads(self.process.stdout.readline()); return response,(time.perf_counter_ns()-started)/1e6
    def notify(self,method): self.process.stdin.write(json.dumps({'jsonrpc':'2.0','method':method})+'\n'); self.process.stdin.flush()
    def close(self): self.process.terminate(); self.process.wait(timeout=3)

def main():
    server=ThreadingHTTPServer(('127.0.0.1',8765),Handler); threading.Thread(target=server.serve_forever,daemon=True).start(); mcp=Mcp()
    try:
        initialized,_=mcp.request('initialize',{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'episode-proof','version':'1.0.0'}}); mcp.notify('notifications/initialized')
        listed,_=mcp.request('tools/list',{}); schema=listed['result']['tools'][0]['inputSchema']
        rest_times=[]; mcp_times=[]; rest_value=mcp_value=None
        for _ in range(50):
            rest_status,rest_value,elapsed=rest_get('GPU-01'); rest_times.append(elapsed)
            response,elapsed=mcp.request('tools/call',{'name':'inventory_lookup','arguments':{'sku':'GPU-01'}}); mcp_times.append(elapsed); mcp_value=response['result']['structuredContent']
        invalid_status,_,_=rest_get('NOT-A-SKU')
        invalid,_=mcp.request('tools/call',{'name':'inventory_lookup','arguments':{'sku':'NOT-A-SKU','extra':True}})
        proof={'protocolVersion':initialized['result']['protocolVersion'],'mcpMethods':['initialize','tools/list','tools/call'],'toolName':'inventory_lookup','schemaRejectsAdditionalProperties':schema['additionalProperties'] is False,'restStatus':rest_status,'sameResult':rest_value==mcp_value,'result':mcp_value,'invalidRestStatus':invalid_status,'invalidMcpRejected':invalid['result']['isError'] is True,'runsPerPath':50,'localMedianMs':{'rest':round(statistics.median(rest_times),3),'mcpStdio':round(statistics.median(mcp_times),3)},'benchmarkScope':'local loopback proof; not a universal transport ranking'}
        assert proof['sameResult'] and proof['invalidMcpRejected'] and invalid_status==400 and rest_status==200
        print(json.dumps(proof,indent=2))
    finally: mcp.close(); server.shutdown(); server.server_close()
if __name__=='__main__': main()
