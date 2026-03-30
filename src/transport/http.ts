import type { Agent, IncomingMessage } from "http";
import { SocksProxyAgent } from "socks-proxy-agent";
import followRedirects from "follow-redirects";
const { http, https } = followRedirects;

import { HTTPPointer } from "../types.js";
import { config } from "../config.js";

export type HTTPRequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

function getRequestAgent(url: URL): Agent | undefined {
  if (url.hostname.endsWith(".onion")) {
    if (!config.tor.enabled) throw new Error("Cant load .onion address without tor");

    return new SocksProxyAgent(config.tor.proxy);
  }
}

export async function makeHTTPRequest(urlInput: string | URL, options: HTTPRequestOptions = {}): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const url = urlInput instanceof URL ? urlInput : new URL(urlInput);
    const agent = getRequestAgent(url);
    const backend = url.protocol === "https:" ? https : http;

    backend
      .get(
        url,
        {
          agent,
          headers: options.headers,
          signal: options.signal,
        },
        (res) => {
          res.once("error", (error) => reject(error));

          if (!res.statusCode) return reject(new Error("Request failed without a status code"));
          if (res.statusCode < 200 || res.statusCode >= 400) {
            res.destroy();
            reject(res);
          } else resolve(res);
        },
      )
      .on("error", (err) => {
        reject(err);
      })
      .end();
  });
}

export async function readHTTPPointer(pointer: HTTPPointer): Promise<IncomingMessage> {
  return makeHTTPRequest(pointer.url);
}
