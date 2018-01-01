'use strict'

const crypto = require('crypto')

const log = require('./log')

class App {
  constructor(endpoint, key, secret) {
    this.endpoint = endpoint
    this.key = key
    this.secret = secret
  }

  sign(data) {
    const digest = crypto.createHmac('sha1', this.secret).update(data).digest()
    return digest.toString('base64', digest.length-6).replace(/\+/g, '-').replace(/\//g, '_')
  }

  url(method, action, data) {
    const url = `${action}/${this.key}/${data}`
    const signature = this.sign(`${method.toUpperCase()} ${url}`)
    return this.endpoint + url + '/' + signature
  }
}

class Resize {
  constructor(data) {
    this.width = data.width || 0
    this.height = data.height || 0
    this.crop = data.crop || false
  }

  toString() {
    var resize = ''
    if (this.width > 0 && this.height > 0 && this.width == this.height) {
      resize = `s${this.width}`
    }
    else if (this.width > 0 && this.height > 0) {
      resize = `w${this.width}-h${this.height}` 
    }
    else if (this.width > 0) {
      resize = `w${this.width}` 
    }
    else if (this.height > 0) {
      resize = `h${this.height}` 
    }

    if (resize && this.crop) {
      resize += '-c'
    }
    return resize
  }
}

class Download {
  constructor(app, data, resize, filename) {
    this.app = app
    this.data = data
    this.resize = resize
    this.filename = filename
  }

  url() {
    var data = this.data
    var resize = this.resize ? this.resize.toString() : ''
    if (resize) {
      data += ',' + resize
    }
    if (this.filename) {
      if (/^[A-Za-z0-9\-_]*(\.[A-Za-z0-9\-_]+)+$/.test(this.filename)) {
        data += ',' + this.filename
      }
    }
    return this.app.url('GET', '', data)
  }
}

class Upload {
  constructor(app, limit, content_types, resize) {
    this.app = app
    this.limit = limit || 0
    this.content_types = content_types
    this.resize = resize
    this.timestamp = parseInt(new Date().getTime() / 1000)
    this.nonce = new Date().getTime().toString()
  }

  url() {
    var data = JSON.stringify({
      timestamp: this.timestamp,
      nonce: this.nonce,
      limit: this.limit ? this.limit : undefined,
      content_types: this.content_types ? this.content_types : undefined,
      resize: this.resize ? this.resize.toString() : undefined,
    })
    data = new Buffer(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    return this.app.url('POST', '/upload', data)
  }
}

const app = new App(
  process.env.UPFLARE_ENDPOINT || 'https://fs.upflare.net',
  process.env.UPFLARE_API_KEY,
  process.env.UPFLARE_API_SECRET
)

const download_url = (url, resize, filename) => {
  var data = new Buffer(url).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
  return new Download(app, data, resize, filename).url()
}

const download_hash = (hash, resize, filename) => {
  if (/^[0-9a-f]{40}$/.test(hash)) {
    return new Download(app, hash, resize, filename).url()
  }
  return ''
}

const download_upload = (id, resize, filename) => {
  if (/^[A-Za-z0-9]{32}$/.test(id)) {
    return new Download(app, id, resize, filename).url()
  }
  return ''
}

const upload = (limit, content_types, resize) => {
  return new Upload(app, limit, content_types, resize).url()
}

const verify_upload = (data) => {
  if (!data || data.key != app.key) {
    return false
  }

  var values = {
    key: app.key,
    id: data.id,
    filename: data.filename,
    hash: data.hash,
    size: data.size,
    content_type: data.content_type,
    timestamp: data.timestamp,
    nonce: data.nonce,
  }
  if (data.width) {
    values.width = data.width
  }
  if (data.height) {
    values.height = data.height
  }
  const base = JSON.stringify(values, Object.keys(values).sort())
  const signature = app.sign(base)
  log.debug(`base = ${base}, signature = ${signature}, ${data.signature}`)
  return signature == data.signature
}

module.exports = {
  App,
  Resize,
  Download,
  download_url,
  download_hash,
  download_upload,
  upload,
  verify_upload,
}
