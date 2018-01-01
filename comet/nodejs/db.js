'use strict'

const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const md5 = require('md5')

const utils = require('./utils')
const security = require('./security')
const upflare = require('./upflare')
const log = require('./log')

class User {
  constructor(manager, id, data) {
    this.manager = manager
    this.id = id
    this.update(data)
  }

  update(data) {
    this.email = data.email !== undefined ? data.email : (this.email || '')
    this.wechat = data.wechat !== undefined ? data.wechat : (this.wechat || null)
    this.password = data.password !== undefined ? data.password : (this.password || null)
    this.name = data.name !== undefined ? data.name : (this.name || '')
    this.bio = data.bio !== undefined ? data.bio : (this.bio || '')
    this.role = data.role !== undefined ? data.role : (this.role || null)
    this.avatar = data.avatar !== undefined ? data.avatar : (this.avatar || null)
    this.is_banned = data.is_banned !== undefined ? data.is_banned : (this.is_banned || false)
    this.location = data.location !== undefined ? data.location : (this.location || null)
    this.modified = data.modified !== undefined ? data.modified : utils.get_timestamp()
    this.created = data.created !== undefined ? data.created : (this.created || this.modified)
    return this
  }

  generate_avatar_url(resize) {
    if (this.avatar) {
      return upflare.download_upload(this.avatar.id, resize || 's200-c')
    }
    if (this.wechat && this.wechat.avatar) {
      return upflare.download_url(this.wechat.avatar, resize || 's200-c')
    }
    return undefined
  }

  full() {
    return {
      id: this.id,
      name: this.name,
      bio: this.bio,
      role: this.role,
      avatar: this.generate_avatar_url('s200-c'),
    }
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      avatar: this.generate_avatar_url('s40-c'),
    }
  }

  dump() {
    return {
      name: this.name,
      email: this.email,
      wechat: this.wechat,
      password: this.password,
      bio: this.bio,
      role: this.role,
      avatar: this.avatar,
      location: this.location,
      is_banned: this.is_banned,
      created: this.created,
      modified: this.modified,
    }
  }
}

class UserManager {
  constructor(db) {
    this.db = db
    this.suffix = '.user.yaml'
    this.root = path.join(db.root, 'user')
    mkdirp.sync(this.root)

    this.users = {}
    this.emails = {}
    this.wechats = {}

    this.init()
  }

  init() {
    for (let filename of fs.readdirSync(this.root)) {
      if (!filename.endsWith(this.suffix)) {
        continue
      }
      const user_id = filename.substr(0, filename.length-this.suffix.length)
      if (!utils.is_id(user_id)) {
        continue
      }
      let content = fs.readFileSync(path.join(this.root, filename), {encoding: 'utf8'})
      var data = utils.parse_yaml(content)
      if (!data) {
        continue
      }
      let user = new User(this, user_id, data)
      this.users[user.id] = user
      this.emails[user.email] = user.id
      if (user.wechat) {
        this.wechats[user.wechat.id] = user.id
      }
    }
  }

  register(data, callback) {
    if (this.emails[data.email]) {
      return callback(null, null, 'email_in_use')
    }

    security.generate_random_id(16, (user_id) => {
      if (!user_id || (user_id in this.users)) {
        return callback(null, null, 'internal_error')
      }

      security.hash_password(data.password, (password) => {
        if (!password) {
          return callback(null, null, 'internal_error')
        }

        var user = new User(this, user_id, {
          email: data.email,
          password,
          name: data.name,
          location: data.location,
        })

        // write user
        fs.writeFile(path.join(this.root, user.id+this.suffix), utils.dump_yaml(user.dump()), (error) => {
          if (error) {
            log.error(`db: failed to write user ${user.id} to file: ${error}`)
            return callback(null, null, 'internal_error')
          }

          this.users[user.id] = user
          this.emails[user.email] = user.id

          this.db.sessions.create({user_id: user.id, location: data.location}, (session) => {
            if (!session) {
              return callback(null, null, 'internal_error')
            }
            return callback(user, session)
          })
        })
      })
    })
  }

  login(data, callback) {
    if (!this.emails[data.email]) {
      return callback(null, null, 'incorrect_password')
    }

    var user = this.users[this.emails[data.email]]
    if (!user) {
      return callback(null, null, 'incorrect_password')
    }

    security.verify_password(data.password, user.password, (ok) => {
      if (!ok) {
        return callback(null, null, 'incorrect_password')
      }
      this.db.sessions.create({user_id: user.id, location: data.location}, (session) => {
        if (!session) {
          return callback(null, null, 'internal_error')
        }

        this.located(user.id, data.location)
        return callback(user, session)
      })
    })
  }

  verify(user_id, data, callback) {
    var user = this.users[user_id]
    if (!user) {
      return callback(false)
    }

    security.verify_password(data.password, user.password, callback)
  }

  passwd(user_id, data, callback) {
    var user = this.users[user_id]
    if (!user) {
      return callback('internal_error')
    }

    security.hash_password(data.password, (password) => {
      if (!password) {
        return callback('internal_error')
      }
      user.update({
        password,
      })
      fs.writeFile(path.join(this.root, user.id+this.suffix), utils.dump_yaml(user.dump()), (error) => {
        if (error) {
          log.error(`db: failed to write user ${user.id} to file: ${error}`)
          return callback('internal_error')
        }
        callback()
      })
    })
  }

  edit(user_id, data, callback) {
    var user = this.users[user_id]
    if (!user) {
      return callback(null)
    }

    user.update(data)

    if (user.wechat && user.wechat.id) {
      this.wechats[user.wechat.id] = user.id
    }

    fs.writeFile(path.join(this.root, user.id+this.suffix), utils.dump_yaml(user.dump()), (error) => {
      if (error) {
        log.error(`db: failed to write user ${user.id} to file: ${error}`)
        return callback(null)
      }
      callback(user)
    })
  }

  located(user_id, location) {
    if (!location) {
      return
    }

    var user = this.users[user_id]
    if (!user) {
      return
    }

    if (user.location && user.location.id == location.id) {
      return
    }

    user.update({
      location,
    })

    fs.writeFile(path.join(this.root, user.id+this.suffix), utils.dump_yaml(user.dump()), (error) => {
      if (error) {
        log.error(`db: failed to write user ${user.id} to file: ${error}`)
      }
    })
  }

  get(user_id) {
    return this.users[user_id] || null
  }

  lookup(wechat_id) {
    return this.get(this.wechats[wechat_id] || null)
  }
}

class Session {
  constructor(manager, id, data) {
    this.manager = manager
    this.id = id
    this.update(data)
  }

  update(data) {
    this.user_id = data.user_id !== undefined ? data.user_id : (this.user_id || '')
    this.location = data.location !== undefined ? data.location : (this.location || null)
    this.modified = data.modified !== undefined ? data.modified : utils.get_timestamp()
    this.created = data.created !== undefined ? data.created : (this.created || this.modified)
    return this
  }

  dump() {
    return {
      user_id: this.user_id,
      location: this.location,
      created: this.created,
      modified: this.modified,
    }
  }
}

class SessionManager {
  constructor(db) {
    this.db = db
    this.suffix = '.session.yaml'
    this.root = path.join(this.db.root, 'session')
    mkdirp.sync(this.root)
  }

  create(data, callback) {
    security.generate_random_id(32, (session_id) => {
      if (!session_id) {
        return callback(null)
      }

      var session = new Session(this, session_id, data)
      fs.writeFile(path.join(this.root, session.id+this.suffix), utils.dump_yaml(session.dump()), (error) => {
        if (error) {
          log.error(`db: failed to write session ${sesion.id} to file: ${error}`)
        }
      })
      return callback(session)
    })
  }

  restore(session_id, location, callback) {
    fs.readFile(path.join(this.root, session_id+this.suffix), (error, content) => {
      if (error) {
        log.error(`db: failed to read session ${session_id} from file: ${error}`)
        return callback(null, null)
      }

      var data = utils.parse_yaml(content)
      if (!data) {
        return callback(null, null)
      }

      var session = new Session(this, session_id, data)
      var user = this.db.users.get(session.user_id)
      if (!user) {
        return callback(null, null)
      }

      this.db.users.located(user.id, location)
      return callback(user, session)
    })
  }
}

class Comment {
  constructor(manager, video_id, id, data) {
    this.manager = manager
    this.video_id = video_id
    this.id = id
    this.previous = null
    this.next = null
    this.update(data)
  }

  update(data) {
    this.user_id = data.user_id !== undefined ? data.user_id : (this.user_id || undefined)
    this.content = data.content !== undefined ? data.content : (this.content || '')
    this.is_featured = data.is_featured !== undefined ? data.is_featured : (this.is_featured || undefined)
    this.is_pinned = data.is_pinned !== undefined ? data.is_pinned : (this.is_pinned || undefined)
    this.is_deleted = data.is_deleted !== undefined ? data.is_deleted : (this.is_deleted || undefined)
    this.data = data.data !== undefined ? data.data : (this.data || undefined)
    this.modified = data.modified !== undefined ? data.modified : utils.get_timestamp()
    this.created = data.created !== undefined ? data.created : (this.created || this.modified)
    return this
  }

  full() {
    let user = this.user_id ? this.manager.db.users.get(this.user_id) : undefined
    let data = undefined
    if (this.data) {
      data = {
        channel: this.data.channel,
        id: this.data.id,
        url: this.data.url,
        source: this.data.source ? {
          url: this.data.source.url,
          name: this.data.source.name,
        } : undefined,
        user: this.data.user ? {
          id: this.data.user.id,
          name: this.data.user.name,
          url: this.data.user.url,
          avatar: this.data.user.avatar ? upflare.download_url(this.data.user.avatar, new upflare.Resize({width: 40, height: 40, crop: true})) : undefined,
        } : undefined,
        image: this.data.image ? {
          thumbnail: this.data.image.thumbnail ? upflare.download_url(this.data.image.thumbnail, 'w400') : undefined,
          url: this.data.image.url ? upflare.download_url(this.data.image.url) : undefined,
        } : undefined,
        location: this.data.location ? {
          country: this.data.location.country,
          region: this.data.location.region,
          city: this.data.location.city,
        } : undefined,
      }
    }
    return {
      id: this.id,
      video_id: this.video_id,
      user: user ? user.summary() : undefined,
      content: this.content,
      is_featured: this.is_featured,
      is_pinned: this.is_pinned,
      is_deleted: this.is_deleted,
      data,
      created: this.created,
      modified: this.modified,
    }
  }

  dump() {
    return {
      id: this.id,
      user_id: this.user_id,
      content: this.content,
      is_featured: this.is_featured,
      is_pinned: this.is_pinned,
      is_deleted: this.is_deleted,
      data: this.data,
      created: this.created,
      modified: this.modified,
    }
  }
}

class CommentManager {
  constructor(db, video) {
    this.db = db
    this.video = video

    this.root = path.join(this.db.root, 'comment')
    mkdirp.sync(this.root)
    this.filepath = path.join(this.root, `${this.video.id}.comment.json`)

    this.pinned = null
    this.comments = {}
    this.count = 0
    this.latest = null
    this.stream = null
    this.max = 0

    this.init()
  }

  init() {
    if (!fs.existsSync(this.filepath)) {
      return
    }
    for (let line of fs.readFileSync(this.filepath, {encoding: 'utf8'}).split('\n').filter(Boolean)) {
      var data = utils.parse_json(line)
      if (!data) {
        continue
      }
      let comment_id = data.id
      let comment = null
      if (this.comments[comment_id]) {
        comment = this.comments[comment_id].update(data)
      } else {
        comment = new Comment(this, this.video.id, comment_id, data)
      }
      this.listing(comment)
      if (comment.is_pinned) {
        this.pinned = comment
      }
      this.max = comment.id > this.max ? comment.id : this.max
    }
  }

  list(cursor, limit) {
    limit = limit || 20

    var comment = this.latest
    if (cursor) {
      comment = this.comments[cursor]
      comment = comment ? comment.previous : null
    }

    var comments = []

    // add pinned comment to the result first
    if (!cursor && this.pinned && this.pinned.is_pinned) {
      comments.push(this.pinned)
    }
    while (limit > 0 && comment) {
      // don't need to include pinnned comments again
      if (comment != this.pinned) {
        comments.push(comment)
        limit--
      }
      comment = comment.previous
    }

    cursor = undefined
    if (comments.length > 0 && limit == 0) {
      cursor = comments[comments.length - 1].id
    }

    return {
      comments,
      cursor,
    }
  }

  get(comment_id) {
    return this.comments[comment_id] || null
  }

  add(data) {
    let comment_id = ++this.max
    let comment = new Comment(this, this.video.id, comment_id, data)
    this.listing(comment)
    this.save(comment)
    this.broadcast(comment)
    this.pinning(comment)
    return comment
  }

  edit(comment_id, data) {
    let comment = this.comments[comment_id]
    if (!comment) {
      return null
    }
    comment = comment.update(data)
    this.listing(comment)
    this.save(comment)
    this.broadcast(comment)
    this.pinning(comment)
    return comment
  }

  delete(comment_id) {
    let comment = this.comments[comment_id]
    if (!comment) {
      return null
    }
    comment = comment.update({is_deleted: true})
    this.listing(comment)
    this.save(comment)
    this.broadcast(comment)
    this.pinning(comment)
    return comment
  }

  listing(comment) {
    if (comment.is_deleted) {
      // remove this comment from video
      if (comment.id in this.comments) {
        delete this.comments[comment.id]
        this.count--
        if (comment.previous) {
          comment.previous.next = comment.next
        }
        if (comment.next) {
          comment.next.previous = comment.previous
        } else {
          this.latest = comment.previous
        }
      }
    } else {
      // add this comment to video
      if (!(comment.id in this.comments)) {
        if (this.latest) {
          comment.previous = this.latest
          this.latest.next = comment
        }
        this.count++
        this.latest = comment
        this.comments[comment.id] = comment
      }
    }
  }

  pinning(comment) {
    if (comment.is_deleted) {
      // remove comment from pinned
      if (this.pinned == comment) {
        this.pinned = null
      }
    } else {
      if (comment.is_pinned) {
        if (this.pinned && this.pinned != comment) {
          this.pinned.update({is_pinned: false})
          this.save(this.pinned)
        }
        this.pinned = comment
      }
      else {
        // remove comment from pinned
        if (this.pinned == comment) {
          this.pinned = null
        }
      }
    }
  }

  broadcast(comment) {
    this.db.comet.io.to(comment.video_id).emit('comment_broadcast', {
      comment: comment.full()
    })
  }

  save(comment) {
    if (!this.stream) {
      this.stream = fs.createWriteStream(this.filepath, {flags: 'a'})
    }
    this.stream.write(JSON.stringify(comment.dump()) + '\n')
  }
}

class StatsManager {
  constructor(db, video) {
    this.db = db
    this.video = video

    this.root = path.join(this.db.root, 'stats')
    mkdirp.sync(this.root)
    this.filepath = path.join(this.root, `${this.video.id}.stats.yaml`)

    this.init()
  }

  init() {
    var stats = {}
    if (fs.existsSync(this.filepath)) {
      stats = utils.parse_yaml(fs.readFileSync(this.filepath, {encoding: 'utf8'}))
    }
    this.stats = stats
  }

  full() {
    return {
      views_count: this.stats.views_count,
      viewers_max: this.stats.viewers_max || this.stats.views_count,
      locations_max: Object.keys(this.stats.locations || {}).length,
      program_index: this.stats.program_index,
    }
  }

  increment(stats) {
    for (let counter in stats) {
      this.stats[counter] = (this.stats[counter] || 0) + stats[counter]
    }
    this.save()
  }

  max(stats) {
    var changed = false
    for (let counter in stats) {
      if (stats[counter] > (this.stats[counter] || 0)) {
        this.stats[counter] = stats[counter]
        changed = true
      }
    }
    if (changed) {
      this.save()
    }
  }

  union(stats) {
    var changed = false
    for (let counter in stats) {
      for (let key in stats[counter]) {
        this.stats[counter] = this.stats[counter] || {}
        if (!this.stats[counter][key]) {
          this.stats[counter][key] = stats[counter][key]
          changed = true
        }
      }
    }
    if (changed) {
      this.save()
    }
  }

  set(stats) {
    for (let counter in stats) {
      this.stats[counter] = stats[counter]
    }
    this.save()
  }

  save() {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      let content = utils.dump_yaml(this.stats)
      fs.writeFile(this.filepath, content, (error) => {
        if (error) {
          log.error(`db: failed to write stats: ${this.filepath}: ${error}`)
        }
      })
    }, 5000)
  }
}

class Video {
  constructor(manager, id, data) {
    this.manager = manager
    this.id = id
    this.update(data)

    this.comments = new CommentManager(this.manager.db, this)
    this.stats = new StatsManager(this.manager.db, this)
  }

  update(data) {
    this.title = data.title !== undefined ? data.title : (this.title || '')
    this.description = data.description !== undefined ? data.description : (this.description || '')
    this.poster = data.poster !== undefined ? data.poster : (this.poster || '')
    this.source = data.source !== undefined ? data.source : (this.source || {})
    this.clip = data.clip !== undefined ? data.clip : (this.clip || {})
    this.aspect_ratio = data.aspect_ratio !== undefined ? data.aspect_ratio : (this.aspect_ratio || 0.5625)
    this.program = data.program !== undefined ? data.program : (this.program || [])
    this.timestamp = data.timestamp !== undefined ? data.timestamp : (this.timestamp || 0)
    this.is_featured = data.is_featured !== undefined ? data.is_featured : (this.is_featured || false)
    this.is_live = data.is_live !== undefined ? data.is_live : (this.is_live || false)
    this.is_commentable = data.is_commentable !== undefined ? data.is_commentable : (this.is_commentable || false)
    this.is_clippable = data.is_clippable !== undefined ? data.is_clippable : (this.is_clippable || false)
    this.is_deleted = data.is_deleted !== undefined ? data.is_deleted : (this.is_deleted || undefined)
    this.modified = data.modified !== undefined ? data.modified : utils.get_timestamp()
    this.created = data.created !== undefined ? data.created : (this.created || this.modified)
    return this
  }

  full() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      poster: this.poster,
      source: this.source,
      clip: this.clip,
      aspect_ratio: this.aspect_ratio,
      program: this.program,
      timestamp: this.timestamp,
      is_commentable: this.is_commentable,
      is_clippable: this.is_clippable,
      is_featured: this.is_featured,
      is_live: this.is_live,
      is_deleted: this.is_deleted,
      created: this.created,
      modified: this.modified,
      stats: Object.assign({}, this.manager.db.viewers.tally(this.id), this.stats.full(), {
        comments_count: this.comments.count,
      }),
    }
  }

  stats_only() {
    return {
      id: this.id,
      stats: Object.assign({}, this.manager.db.viewers.tally(this.id), this.stats.full(), {
        comments_count: this.comments.count,
      }),
    }
  }
}

class VideoManager {
  constructor(db) {
    this.db = db
    this.suffix = '.video.yaml'
    this.root = path.join(this.db.root, 'video')
    mkdirp.sync(this.root)

    this.videos = {}

    this.init()

    // broadcast video stats every once a while
    this.timer = setInterval(() => {
      var videos = []
      for (let video_id in this.videos) {
        videos.push(this.videos[video_id].stats_only())
      }

      this.db.comet.io.sockets.emit('video_stats', {
        videos,
      })
    }, 3000)
  }

  init() {
    // an index of videos
    for (let filename of fs.readdirSync(this.root)) {
      if (!filename.endsWith(this.suffix)) {
        continue
      }
      const video_id = filename.substr(0, filename.length-this.suffix.length)
      if (!utils.is_id(video_id)) {
        continue
      }
      let content = fs.readFileSync(path.join(this.root, filename), {encoding: 'utf8'})
      let data = utils.parse_yaml(content)
      let video = new Video(this, video_id, data)
      this.videos[video.id] = video
    }

    // watch the folder
    var changes = {}
    fs.watch(this.root, (eventType, filename) => {
      log.verbose(`db: eventType = ${eventType}, filename = ${filename}`)
      if (!filename.endsWith(this.suffix)) {
        return
      }
      const video_id = filename.substr(0, filename.length-this.suffix.length)
      if (!utils.is_id(video_id)) {
        return
      }
      if (changes[filename]) {
        clearTimeout(changes[filename])
      }
      changes[filename] = setTimeout(() => {
        fs.readFile(path.join(this.root, filename), (error, content) => {
          let data = utils.parse_yaml(error ? '' : content) || {is_deleted: true}
          let video = this.videos[video_id] ? this.videos[video_id].update(data) : new Video(this, video_id, data)
          if (video.is_deleted) {
            delete this.videos[video_id]
            log.warn(`db: video ${video.id} titled ${video.title} has been removed`)
          } else {
            this.videos[video.id] = video
            log.warn(`db: video ${video.id} titled ${video.title} has been reloaded`)
            this.broadcast(video)
          }
        })
      }, 500)
    })
  }

  list() {
    var videos = []
    for (let video_id in this.videos) {
      videos.push(this.videos[video_id])
    }
    return videos
  }

  get(video_id) {
    return this.videos[video_id] || null
  }

  broadcast(video) {
    this.db.comet.io.sockets.emit('video_broadcast', {
      video: video.full(),
    })
  }
}

class Viewer {
  constructor(manager, id, data) {
    this.manager = manager
    this.id = id
    this.update(data)
  }

  update(data) {
    this.ip = data.ip !== undefined ? data.ip : (this.ip || undefined)
    this.location = data.location !== undefined ? data.location : (this.location || undefined)

    this.user_id = data.user_id !== undefined ? data.user_id : (this.user_id || undefined)
    this.session_id = data.session_id !== undefined ? data.session_id : (this.session_id || undefined)
    this.video_id = data.video_id !== undefined ? data.video_id : (this.video_id || undefined)

    this.is_disconnected = data.is_disconnected !== undefined ? data.is_disconnected : (this.is_disconnected || undefined)

    this.modified = data.modified !== undefined ? data.modified : utils.get_timestamp()
    this.created = data.created !== undefined ? data.created : (this.created || this.modified)
    return this
  }

  dump() {
    return {
      id: this.id,
      ip: this.ip,
      location: this.location,
      user_id: this.user_id,
      session_id: this.session_id,
      video_id: this.video_id,
      is_disconnected: this.is_disconnected,
      created: this.created,
      modified: this.modified,
    }
  }
}

class ViewerManager {
  constructor(db) {
    this.db = db
    this.root = path.join(db.root, 'viewer')
    mkdirp.sync(this.root)

    this.filepath = path.join(this.root, `${parseInt(utils.get_timestamp())}.viewer.json`)
    this.stream = fs.createWriteStream(this.filepath, {flags: 'a'})
    this.viewers = {}

    // multiple levels, first by video_id, then by location_id
    this.stats = {}
  }

  tally(video_id) {
    var viewers_count = 0;
    var viewers = {}
    if (this.stats[video_id]) {
      for (let location_id in this.stats[video_id]) {
        var count = Object.keys(this.stats[video_id][location_id]).length
        viewers_count += count
        if (location_id && count > 0) {
          viewers[location_id] = count
        }
      }
    }
    return {
      viewers,
      viewers_count,
    }
  }

  update(viewer_id, data) {
    var viewer = this.viewers[viewer_id]
    if (!viewer) {
      viewer = new Viewer(this, viewer_id, data)
    }
    else {
      let old_video_id = viewer.video_id || ''
      let old_location_id = viewer.location ? viewer.location.id : ''
      this.viewers[viewer_id].update(data)

      // need to remove from old video stats
      if (
        old_video_id != viewer.video_id ||
        old_location_id != (viewer.location ? viewer.location.id : '') ||
        viewer.is_disconnected
      ) {
        if (old_video_id) {
          delete this.stats[old_video_id][old_location_id][viewer.id]
        }
      }
    }

    if (viewer.is_disconnected) {
      delete this.viewers[viewer.id]
    }
    else {
      let video_id = viewer.video_id || ''
      let location_id = viewer.location ? viewer.location.id : ''

      if (video_id) {
        this.stats[video_id] = this.stats[video_id] || {}
        this.stats[video_id][location_id] = this.stats[video_id][location_id] || {}
        this.stats[video_id][location_id][viewer.id] = viewer
      }
      this.viewers[viewer.id] = viewer
    }

    this.stream.write(JSON.stringify(viewer.dump()) + '\n')
    return viewer
  }
}

class Database {
  constructor(comet) {
    this.comet = comet

    this.root = process.env.DATA_DIR || '/data'
    mkdirp.sync(this.root)

    this.users = new UserManager(this)
    this.sessions = new SessionManager(this)
    this.videos = new VideoManager(this)
    this.viewers = new ViewerManager(this)
  }
}

module.exports = {
  Database,
}
