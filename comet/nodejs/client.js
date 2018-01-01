'use strict'

const utils = require('./utils')
const log = require('./log')
const upflare = require('./upflare')

class Client {

  constructor(comet, socket) {
    this.comet = comet
    this.socket = socket

    this.id = this.socket.id
    this.session = null
    this.user = null
    this.video = null

    // get client ip and locate it
    this.ip = utils.get_socket_ip(this.socket)
    this.location = utils.locate_ip(this.ip)
    this.comet.db.viewers.update(this.id, {
      ip: this.ip,
      location: this.location,
    })
    log.debug(`connected: socket = ${this.id}, ip = ${this.ip}, location = ${JSON.stringify(this.location)}`)

    // handle events
    this.socket.on('user_session', data => this.user_session(data.session_id))
    this.socket.on('user_register', data => this.user_register(data.email, data.password, data.name))
    this.socket.on('user_login', data => this.user_login(data.email, data.password))
    this.socket.on('user_passwd', data => this.user_passwd(data.user_id, data.old_password, data.new_password))
    this.socket.on('user_edit', data => this.user_edit(data.user_id, data.name, data.bio))
    this.socket.on('user_avatar', data => this.user_avatar(data.user_id, data.avatar))
    this.socket.on('user_connect', data => this.user_connect(data.token))
    this.socket.on('user_ban', data => this.user_ban(data.user_id))
    this.socket.on('user_unban', data => this.user_unban(data.user_id))
    this.socket.on('user_cooldown', data => this.user_cooldown(data.user_id, data.cooldown))
    this.socket.on('user_logout', data => this.user_logout())

    this.socket.on('video_list', data => this.video_list())
    this.socket.on('video_get', data => this.video_get(data.video_id))
    this.socket.on('video_set', data => this.video_set(data.video_id, data.program_index))

    this.socket.on('comment_list', data => this.comment_list(data.video_id, data.cursor))
    this.socket.on('comment_add', data => this.comment_add(data.video_id, data.content))
    this.socket.on('comment_edit', data => this.comment_edit(data.video_id, data.comment_id, data.content, data.is_featured, data.is_pinned))
    this.socket.on('comment_delete', data => this.comment_delete(data.video_id, data.comment_id))

    this.socket.on('rtc_offer', data => this.rtc_offer(data.id, data.offer, data.candidates))
    this.socket.on('rtc_answer', data => this.rtc_answer(data.id, data.answer, data.candidates))

    this.socket.on('tracker_fragment', data => this.tracker_fragment(data.url, data.contributors || [], data.candidates || []))
    this.socket.on('tracker_report', data => this.tracker_report(data.fragments || {}, parseInt(data.slots), data.stats || {}))

    this.socket.on('disconnect', () => this.disconnect())
  }

  user_session(session_id) {
    if (this.session || this.user) {
      return
    }

    this.comet.db.sessions.restore(session_id, this.location, (user, session) => {
      this.user = user
      this.session = session
      this.comet.db.viewers.update(this.id, {
        user_id: this.user ? this.user.id : null,
        session_id: this.session ? this.session.id : null,
      })
      this.socket.emit('user_session', {
        user: user ? user.full() : null,
        session_id: session ? session.id : null,
      })
    })
  }

  user_register(email, password, name) {
    if (this.session || this.user) {
      return
    }

    if (!email || !password || !name) {
      return
    }

    email = email.trim().toLowerCase()
    if (!utils.is_email(email) || email.length > 100) {
      return
    }

    name = name.trim()
    if (!name || name.length > 20) {
      return
    }

    if (password.length < 6 || password.length > 100) {
      return
    }

    this.comet.db.users.register({
      email,
      password,
      name,
      location: this.location,
    }, (user, session, error) => {
      this.user = user
      this.session = session
      this.comet.db.viewers.update(this.id, {
        user_id: this.user ? this.user.id : null,
        session_id: this.session ? this.session.id : null,
      })
      this.socket.emit('user_register', {
        user: user ? user.full() : null,
        session_id: session ? session.id : null,
        error,
      })
    })
  }

  user_login(email, password) {
    if (this.session || this.user) {
      return
    }

    if (!email || !password) {
      return
    }

    email = email.trim().toLowerCase()
    if (!utils.is_email(email) || email.length > 100) {
      return
    }

    if (password.length < 6 || password.length > 100) {
      return
    }

    this.comet.db.users.login({
      email,
      password,
      location: this.location,
    }, (user, session, error) => {
      this.user = user
      this.session = session
      this.comet.db.viewers.update(this.id, {
        user_id: this.user ? this.user.id : null,
        session_id: this.session ? this.session.id : null,
      })
      this.socket.emit('user_login', {
        user: user ? user.full() : null,
        session_id: session ? session.id : null,
        error,
      })
    })
  }

  user_passwd(user_id, old_password, new_password) {
    if (!this.session || !this.user) {
      return
    }

    if (!old_password || !new_password) {
      return
    }

    if (old_password.length < 6 || old_password.length > 100) {
      return
    }

    if (new_password.length < 6 || new_password.length > 100) {
      return
    }

    if (this.user.role != 'admin' && user_id) {
      return
    }

    user_id = user_id || this.user.id

    // first verify old password
    this.comet.db.users.verify(user_id, {password: old_password}, (ok) => {
      if (!ok) {
        return this.socket.emit('user_passwd', {
          user_id: user_id,
          error: 'incorrect_password',
        })
      }

      // then change password
      this.comet.db.users.passwd(user_id, {password: new_password}, (error) => {
        return this.socket.emit('user_passwd', {
          user_id: user_id,
          error,
        })
      })
    })
  }

  user_edit(user_id, name, bio) {
    if (!this.session || !this.user) {
      return
    }

    if (name !== undefined) {
      name = name.trim()
      if (!name || name.length > 20) {
        return
      }
    }

    if (bio !== undefined) {
      bio = bio.trim()
      if (bio.length > 140) {
        return
      }
    }

    if (this.user.role != 'admin' && user_id) {
      return
    }

    user_id = user_id || this.user.id

    this.comet.db.users.edit(user_id, {
      name,
      bio,
    }, (user) => {
      this.socket.emit('user_edit', {
        user_id: user_id,
        user: user ? user.full() : null,
      })
    })
  }

  user_avatar(user_id, avatar) {
    if (!this.session || !this.user) {
      return
    }

    if (this.user.role != 'admin' && user_id) {
      return
    }

    user_id = user_id || this.user.id

    if (!avatar) {
      this.socket.emit('user_avatar', {
        user_id: user_id,
        upload: upflare.upload(4*1024*1024, ['image/jpeg', 'image/png'], 's240-c'),
      })
      return
    }

    if (!upflare.verify_upload(avatar)) {
      this.socket.emit('user_avatar', {
        user_id: user_id,
        error: 'invalid_signature',
      })
    }

    this.comet.db.users.edit(user_id, {
      avatar: {
        id: avatar.id,
        hash: avatar.hash,
        filename: avatar.filename,
        content_type: avatar.content_type,
        size: avatar.size,
        width: avatar.width,
        height: avatar.height,
      },
    }, (user) => {
      this.socket.emit('user_avatar', {
        user_id: user_id,
        user: user ? user.full() : null,
      })
    })
  }

  user_connect(token) {
    if (!this.session || !this.user) {
      return
    }

    const wechat_id = this.comet.wechat.verify(token)
    if (!wechat_id) {
      this.socket.emit('user_connect', {
        token: token,
        error: 'invalid_token',
      })
      return
    }

    if (this.user.wechat && this.user.wechat.id == wechat_id) {
      this.socket.emit('user_connect', {
        token: token,
      })
      return
    }

    if (this.user.wechat) {
      this.socket.emit('user_connect', {
        token: token,
        error: 'already_connected',
      })
      return
    }

    if (this.comet.db.users.lookup(wechat_id)) {
      this.socket.emit('user_connect', {
        token: token,
        error: 'invalid_token',
      })
      return
    }

    this.comet.db.users.edit(this.user.id, {
      wechat: {
        id: wechat_id,
      },
    }, (user) => {
      this.socket.emit('user_connect', {
        token: token,
      })
    })
  }

  user_ban(user_id) {
    if (!this.session || !this.user) {
      return
    }

    if (this.user.role != 'admin') {
      return
    }

    this.comet.db.users.edit(user_id, {
      is_banned: true,
    }, (user) => {
      this.socket.emit('user_ban', {
        user_id: user_id,
        user: user ? user.full() : null,
      })
    })
  }

  user_unban(user_id) {
    if (!this.session || !this.user) {
      return
    }

    if (this.user.role != 'admin') {
      return
    }

    this.comet.db.users.edit(user_id, {
      is_banned: false,
    }, (user) => {
      this.socket.emit('user_unban', {
        user_id: user_id,
        user: user ? user.full() : null,
      })
    })
  }

  user_cooldown(user_id, cooldown) {
    if (!this.session || !this.user) {
      return
    }

    if (this.user.role != 'admin') {
      return
    }

    const user = this.comet.db.users.get(user_id)
    if (user) {
      user.cooldown = utils.get_timestamp() + (cooldown || 120)
    }
    this.socket.emit('user_cooldown', {
      user_id: user_id,
      user: user ? user.full() : null,
    })
  }

  user_logout() {
    this.user = null
    this.session = null
    this.comet.db.viewers.update(this.id, {
      user_id: null,
      session_id: null,
    })
    this.socket.emit('user_logout')
  }

  video_list() {
    // if (this.video) {
    //   this.socket.leave(this.video.id)
    //   this.video = null
    // }

    var videos = this.comet.db.videos.list()
    // this.comet.db.viewers.update(this.id, {
    //   video_id: null,
    // })
    this.socket.emit('video_list', {
      videos: videos.map(video => video.full()),
    })
  }

  video_get(video_id) {
    var video = this.comet.db.videos.get(video_id)
    if (video) {
      video.stats.increment({
        views_count: 1,
      })
    }
    if (this.video && this.video != video) {
      this.socket.leave(this.video.id)
      this.video = null
    }
    if (video && video != this.video) {
      this.socket.join(video.id)
      this.video = video
    }
    this.comet.db.viewers.update(this.id, {
      video_id: video ? video.id : null,
    })
    if (video) {
      const stats = video.stats_only()
      video.stats.max({
        viewers_max: stats.stats.viewers_count,
      })
      if (this.location) {
        video.stats.union({
          locations: {
            [this.location.id]: this.location,
          },
        })
      }
    }
    this.socket.emit('video_get', {
      video_id,
      video: video ? video.full() : null,
    })
  }

  video_set(video_id, program_index) {
    if (!this.session || !this.user) {
      return
    }

    if (!['admin', 'moderator'].includes(this.user.role)) {
      return
    }

    var video = this.comet.db.videos.get(video_id)
    if (video) {
      video.stats.set({
        program_index,
      })
    }
    this.socket.emit('video_set', {
      video_id,
      video: video ? video.stats_only() : null,
    })
  }

  comment_list(video_id, cursor) {
    let comments = null
    let next_cursor = undefined
    var video = this.comet.db.videos.get(video_id)
    if (video) {
      let results = video.comments.list(cursor)
      comments = results.comments
      next_cursor = results.cursor
    }
    this.socket.emit('comment_list', {
      video_id,
      comments: comments ? comments.map(comment => comment.full()) : null,
      cursor: next_cursor,
    })
  }

  comment_add(video_id, content) {
    if (!this.session || !this.user) {
      return
    }

    if (!content || !content.trim() || content.length > 140) {
      return
    }

    var comment = null
    var video = this.comet.db.videos.get(video_id)
    if (video) {
      if (!video.is_commentable && !['admin', 'moderator'].includes(this.user.role)) {
        return
      }
      if (!this.user.is_banned && utils.get_timestamp() > (this.user.cooldown || 0)) {
        this.user.cooldown = utils.get_timestamp() + 3
        comment = video.comments.add({
          user_id: this.user.id,
          content,
          data: {
            location: this.location,
          },
        })
      }
    }
    this.socket.emit('comment_add', {
      comment: comment ? comment.full() : null,
    })
  }

  comment_edit(video_id, comment_id, content, is_featured, is_pinned) {
    if (!this.session || !this.user) {
      return
    }

    if (!['admin', 'moderator'].includes(this.user.role)) {
      return
    }

    if (content !== undefined) {
      // only admin is allowed to edit content
      if (this.user.role != 'admin') {
        return
      }
      if (!content || !content.trim() || content.length > 140) {
        return
      }
    }

    // only admin is allowed to pin
    if (is_pinned !== undefined) {
      if (this.user.role != 'admin') {
        return
      }
    }

    var comment = null
    var video = this.comet.db.videos.get(video_id)
    if (video) {
      // if admin pin something, moderator cannot override it
      if (this.user.role != 'admin') {
        comment = video.comments.get(comment_id)
        if (comment && comment.is_pinned) {
          return
        }
      }
      comment = video.comments.edit(comment_id, {
        content,
        is_featured,
        is_pinned,
      })
    }
    this.socket.emit('comment_edit', {
      video_id,
      comment_id,
      comment: comment ? comment.full() : null,
    })
  }

  comment_delete(video_id, comment_id) {
    if (!this.session || !this.user) {
      return
    }

    var comment = null
    var video = this.comet.db.videos.get(video_id)
    if (video) {
      if (this.user.role != 'admin') {
        comment = video.comments.get(comment_id)
        // if admin pin something, moderator cannot override it
        if (comment && comment.is_pinned) {
          return
        }
        // cannot remove comment unless you are moderator or the commenter
        if (this.user.role != 'moderator') {
          if (comment && comment.user_id != this.user.id) {
            return
          }
        }
      }
      comment = video.comments.delete(comment_id)
    }
    this.socket.emit('comment_delete', {
      video_id,
      comment_id,
      comment: comment ? comment.full() : null,
    })
  }

  rtc_offer(id, offer, candidates) {
    // facilitate p2p offer
    this.comet.io.to(id).emit('rtc_offer', {
      id: this.id,
      offer,
      candidates,
    })
  }

  rtc_answer(id, answer, candidates) {
    // facilitate p2p answer
    this.comet.io.to(id).emit('rtc_answer', {
      id: this.id,
      answer,
      candidates,
    })
  }

  tracker_fragment(url, contributors, candidates) {
    // user query for a fragment
    // figure out list of seeders to offer
    const seeders = this.comet.tracker.query(this.id, this.ip, this.location, url, contributors, candidates)
    this.socket.emit('tracker_fragment', {
      url,
      seeders
    })
  }

  tracker_report(fragments, slots, stats) {
    // user report cache and mesh status
    this.comet.tracker.report(this.id, this.ip, this.location, fragments, slots, stats)
  }

  disconnect() {
    log.debug(`disconnected: socket = ${this.id}, ip = ${this.ip}, location = ${JSON.stringify(this.location)}`)
    this.comet.tracker.remove(this.id)
    this.comet.db.viewers.update(this.id, {
      is_disconnected: true,
    })
  }
}

module.exports = {
  Client,
}
