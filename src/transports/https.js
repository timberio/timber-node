import https from 'https'
import { Writable } from 'stream'
import debug from '../utils/debug'

const HOSTNAME = 'logs.timber.io'
const PATH = '/frames'
const CONTENT_TYPE = 'application/json'
const USER_AGENT = `Timber Node HTTPS Stream/${require('../../package.json')
  .version}`
const PORT = 443

// For debugging purposes, writes to /timber.log
// import fs from 'fs';
// import path from 'path';
// var logger = fs.createWriteStream('timber.log', { flags: 'a' });

/**
 * A highly efficient stream for sending logs to Timber via HTTPS. It uses batches,
 * keep-alive connections (and in the future maybe msgpack) to deliver logs with high-throughput
 * and little overhead. It also implements the Stream.Writable interface so that it can be treated
 * like a stream. This is beneficial when using something like Morgan, where you can pass a custom stream.
 */
class HTTPS extends Writable {
  /**
   * @param {string} apiKey - Timber API Key
   * @param {Object} [options] - Various options to adjust the stream behavior.
   * @param {string} [options.flushInterval=1000] - How often, in milliseconds, the messages written to the stream should be delivered to Timber.
   * @param {string} [options.httpsAgent] - Your own custom https.Agent. We use agents to maintain connection pools and keep the connections alive. This avoids the initial connection overhead every time we want to communicate with Timber. See https.Agent for options.
   */
  constructor(
    apiKey,
    {
      flushInterval = 1000,
      highWaterMark = 5000,
      httpsAgent,
      httpsClient,
      hostName = HOSTNAME,
      path = PATH,
      port = PORT,
    } = {}
  ) {
    // Ensure we use object mode and set a default highWaterMark
    super({ objectMode: true, highWaterMark })
    debug('Initializing HTTPS transport stream')

    this.apiKey = apiKey
    this.hostName = hostName
    this.path = path
    this.port = port
    this.flushInterval = flushInterval
    this.httpsAgent =
      httpsAgent ||
      new https.Agent({
        keepAlive: true,
        maxSockets: 3,
        // Keep the connection open for 1 minute, avoiding reconnects
        keepAliveMsecs: 1000 * 60,
      })
    this.httpsClient = httpsClient || https

    // Cork the stream so we can utilize the internal Buffer. We do *not* want to
    // send a request for every message. The _flusher will take care of flushing the stream
    // on an interval.
    this.cork()

    // In the event the _flusher is not fast enough, we need to monitor the buffer size.
    // If it fills before the next flush event, we should immediately flush.

    if (flushInterval !== undefined && flushInterval > 0) {
      debug('Starting stream flusher')
      this._startFlusher()
    }
  }

  /**
   * _writev is a Stream.Writeable methods that, if present, will write multiple chunks of
   * data off of the buffer. Defining it means we do not need to define _write.
   */
  _writev(chunks, next) {
    debug(`Sending ${chunks.length} log to stream`)
    const messages = chunks.map(chunk => chunk.chunk)
    const body = JSON.stringify(messages)
    const options = {
      headers: {
        'Content-Type': CONTENT_TYPE,
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': USER_AGENT,
      },
      agent: this.httpsAgent,
      auth: this.apiKey,
      hostname: this.hostName,
      port: this.port,
      path: this.path,
      method: 'POST',
    }

    const req = this.httpsClient.request(options, () => {})

    req.on('response', res => {
      debug(`${this.hostName} responded with ${res.statusCode}`)
    })

    req.on('error', e => debug(`Error: ${e}`))
    req.write(body)
    req.end()
    next()
  }

  _write(chunk, encoding, next) {
    this._writev([{ chunk, encoding }], next)
  }

  /**
   * Expressive function to flush the buffer contents. uncork flushes the buffer and write
   * the contents. Cork allows us to continue buffering the messages until the next flush.
   */
  _flush() {
    // nextTick is recommended here to allow batching of write calls I think
    process.nextTick(() => {
      this.uncork()
      this.cork()
    })
  }

  /**
   * Interval to call _flush continuously. This ensures log lines get sent on this.flushInterval
   * intervals.
   */
  _startFlusher() {
    setInterval(() => this._flush(), this.flushInterval)
  }
}

export default HTTPS
