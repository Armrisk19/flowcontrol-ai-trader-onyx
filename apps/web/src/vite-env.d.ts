/// <reference types="vite/client" />
interface Window { ethereum?: { request(args:{method:string;params?:unknown[]}):Promise<any>; on?(event:string,listener:(...args:any[])=>void):void } }
