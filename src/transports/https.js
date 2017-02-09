'use strict';

import https from 'http';
import msgpack from 'msgpack';
import { Writable } from 'stream';

const HOSTNAME = 'api.timber.io';
const PATH = '/frames';
const CONTENT_TYPE = 'application/msgpack';
const USER_AGENT = `Timber Node HTTPS Stream/${require('../../package.json').version}`;


// For debugging purposes, writes to /timber.log
import fs from 'fs';
import path from 'path';
var logger = fs.createWriteStream('timber.log', { flags: 'a' });

/**
 * A highly efficient stream for sending logs to Timber via HTTPS. It uses batches,
 * keep-alive connections, and msgpack to deliver logs with high-throughput and little overhead.
 * It also implements the Stream.Writable interface so that it can be treated like a stream.
 * This is beneficial in situation like Morgan, where you can pass a custom stream.
*/
class HTTPSStream extends Writable {
  /**
    * @constructor
    * @param {string} apiKey - Timber API Key
    * @param {Object} [options] - Various opptions to adjust the stream behavior.
    * @param {string} [options.flushInterval=60000] - How often, in milliseconds, the messages written to the stream should be delivered to Timber.
    * @param {string} [options.httpsAgent] - Your own custom https.Agent. We use agents to maintain connection pools and keep the connections alive. This avoids the initial connection overhead every time we want to communicate with Timber. See https.Agent for options.
  */
  constructor(apiKey, { flushInterval = 1000, httpsAgent, httpsClient } = {}) {
    super();

    this.apiKey = apiKey;
    this.flushInterval = flushInterval;
    this.httpsAgent = httpsAgent || new https.Agent({
      keepAlive: true,
      maxSockets: 10,
      keepAliveMsecs: (1000 * 60) // Keeps the connection open for 1 minute, avoiding reconnects
    });
    this.httpsClient = httpsClient || https;

    // Cork the stream so we can utilize the internal Buffer. We do *not* want to
    // send a request for every message. The _flusher will take care of flushing the stream
    // on an interval.
    this.cork();

    // In the event the _flusher is not fast enough, we need to monitor the buffer size.
    // If it fills before the next flush event, we should immediately flush.
    this.on('drain', () => {
      if (this.length >= state.highWaterMark) {
        this._flush();
      }
    });

    if (flushInterval !== undefined && flushInterval > 0)
      this._startFlusher();
  }

  /**
   * _writev is a Stream.Writeable methods that, if present, will write multiple chunks of
   * data off of the buffer. Defining it means we do not need to define _write.
   */
  // let options = {
  //     agent: this.httpsAgent,
  //     auth: this.apiKey,
  //     hostname: HOSTNAME,
  //     path: PATH,
  //     headers: {
  //       'Content-Type': CONTENT_TYPE,
  //       'User-Agent': USER_AGENT
  //     }
  //   };
  // _writev(chunks, callback) {
  //   const messages = chunks.map((chunk) => { return chunk.chunk; });
  //   logger.write(messages);
  //   // const body = msgpack.pack(messages);
  //   // let options = {
  //   //   headers: {
  //   //     'Content-Type': CONTENT_TYPE,
  //   //     'Content-Length': Buffer.byteLength(body),
  //   //     'User-Agent': USER_AGENT
  //   //   },
  //   //   hostname: 'localhost',
  //   //   port: 8080,
  //   //   path: '/',
  //   //   agent: false,
  //   //   method: 'POST'
  //   // };

  //   // let req = this.httpsClient.request(options);

  //   // req.on('error', (e) => {
  //   //   console.log(e);
  //   //   console.log(`Timber request error: ${e.message}`);
  //   // });

  //   // req.write(body);
  //   // req.end();
  // }

  _write(chunk, encoding = 'utf8', cb) {
    logger.write(chunk);
    // this._writev([{chunk: chunk, encoding: encoding}], cb);
  }

  /**
   * Expressive function to flush the buffer contents. uncork flushes the buffer and write
   * the contents. Cork allows us to continue buffering the messages until the next flush.
   */
  _flush() {
    this.uncork();
    this.cork();
  }

  /**
   * Interval to call _flush continuously. This ensures log lines get sent on this.flushInterval
   * intervals.
   */
  _startFlusher() {
    let that = this;
    setInterval(() => { that._flush() }, 100);
  }
}

module.exports = HTTPSStream;