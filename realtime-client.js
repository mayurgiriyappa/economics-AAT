/**
 * BioPopcorn Strategy Court - Realtime Multi-Device Synchronization Client
 * Connects independent participants and hosts across phones, laptops, and tablets.
 * Transports: Supabase Realtime WebSocket Channels + Resilient HTTP Long-Polling Fallback.
 */
(function(window) {
  'use strict';

  // Client ID persistence
  function getClientId() {
    let cid = localStorage.getItem('biopopcorn_client_id');
    if (!cid || cid.length < 8) {
      cid = 'client_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('biopopcorn_client_id', cid);
    }
    return cid;
  }

  // Host Token persistence
  function getHostToken() {
    return localStorage.getItem('biopopcorn_host_token') || '';
  }
  function setHostToken(tok) {
    if (tok) localStorage.setItem('biopopcorn_host_token', tok);
    else localStorage.removeItem('biopopcorn_host_token');
  }

  class RealtimeSyncManager {
    constructor() {
      this.clientId = getClientId();
      this.supabase = null;
      this.activeChannel = null;
      this.pollTimer = null;
      this.lastStateHash = '';
      this.listeners = { state: [], error: [], connect: [] };
      this.currentSessionType = null;
      this.currentRoomPin = null;
      this.isHost = false;

      // Initialize config asynchronously
      this._initSupabase();
    }

    async _initSupabase() {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const config = await res.json();
          if (config.hasSupabase && config.supabaseUrl && config.supabaseAnonKey) {
            if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
              this.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
              console.log('[RealtimeSync] Supabase Realtime client initialized.');
            }
          }
        }
      } catch (e) {
        console.warn('[RealtimeSync] Config check error:', e.message);
      }
    }

    on(event, cb) {
      if (this.listeners[event]) this.listeners[event].push(cb);
    }

    emitEvent(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => {
          try { cb(data); } catch (err) { console.error('[RealtimeSync] Listener error:', err); }
        });
      }
    }

    // Host Login
    async hostLogin(pin) {
      try {
        const res = await fetch('/api/auth/host-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (data.ok && data.hostToken) {
          setHostToken(data.hostToken);
          this.isHost = true;
          return { ok: true, hostToken: data.hostToken };
        }
        return { ok: false, error: data.error || 'Authentication failed.' };
      } catch (e) {
        return { ok: false, error: 'Connection error while authenticating.' };
      }
    }

    // Connect to room (Classroom Quiz or Jury)
    async connectRoom(sessionType, roomPin, isHost = false) {
      this.currentSessionType = sessionType; // 'quiz' or 'jury'
      this.currentRoomPin = roomPin;
      this.isHost = isHost;
      this.lastStateHash = '';

      // Set up Supabase Realtime channel if available
      if (this.supabase) {
        try {
          if (this.activeChannel) this.supabase.removeChannel(this.activeChannel);
          const channelName = `room:${sessionType}:${roomPin}`;
          this.activeChannel = this.supabase.channel(channelName);

          this.activeChannel
            .on('broadcast', { event: 'state_change' }, () => this.fetchState())
            .on('postgres_changes', { event: '*', schema: 'public' }, () => this.fetchState())
            .subscribe();
        } catch (e) {
          console.warn('[RealtimeSync] Supabase channel error:', e.message);
        }
      }

      // Start adaptive HTTP polling
      this.stopPolling();
      this.pollTimer = setInterval(() => this.fetchState(), 1600);
      await this.fetchState();
    }

    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }

    // Fetch state from central API
    async fetchState() {
      if (!this.currentSessionType || !this.currentRoomPin) return;
      const endpoint = this.currentSessionType === 'jury' ? '/api/jury/state' : '/api/quiz/state';
      const hostToken = getHostToken();

      const url = `${endpoint}?pin=${encodeURIComponent(this.currentRoomPin)}&clientId=${encodeURIComponent(this.clientId)}&t=${Date.now()}`;
      try {
        const res = await fetch(url, {
          headers: {
            'X-Client-Id': this.clientId,
            ...(hostToken ? { 'X-Host-Token': hostToken } : {})
          }
        });

        if (res.ok) {
          const state = await res.json();
          const hash = JSON.stringify(state);
          if (hash !== this.lastStateHash) {
            this.lastStateHash = hash;
            this.emitEvent('state', state);
          }
        }
      } catch (err) {
        // network silent retry
      }
    }

    // Broadcast change notification
    notifyChange() {
      if (this.activeChannel) {
        try {
          this.activeChannel.send({
            type: 'broadcast',
            event: 'state_change',
            payload: { timestamp: Date.now() }
          });
        } catch (e) {}
      }
      setTimeout(() => this.fetchState(), 80);
    }

    // Classroom Quiz actions
    async createQuizRoom(question) {
      const hostToken = getHostToken();
      const res = await fetch('/api/quiz/create-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Host-Token': hostToken
        },
        body: JSON.stringify({ hostToken, question })
      });
      const data = await res.json();
      if (data.ok && data.roomPin) {
        await this.connectRoom('quiz', data.roomPin, true);
      }
      return data;
    }

    async joinQuizRoom(roomPin, name) {
      const res = await fetch('/api/quiz/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomPin, name, clientId: this.clientId })
      });
      const data = await res.json();
      if (data.ok) {
        await this.connectRoom('quiz', roomPin, false);
      }
      return data;
    }

    async submitQuizStance(roomPin, name, stance, reasoning) {
      const res = await fetch('/api/quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomPin,
          clientId: this.clientId,
          name,
          stance,
          reasoning
        })
      });
      const data = await res.json();
      if (data.ok) {
        this.notifyChange();
      }
      return data;
    }

    async quizHostAction(roomPin, action) {
      const hostToken = getHostToken();
      const res = await fetch('/api/quiz/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Host-Token': hostToken
        },
        body: JSON.stringify({ roomPin, action, hostToken })
      });
      const data = await res.json();
      if (data.ok) {
        this.notifyChange();
      }
      return data;
    }

    // Courtroom & Jury Voting actions
    async createJuryRoom(questions) {
      const hostToken = getHostToken();
      const res = await fetch('/api/jury/create-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Host-Token': hostToken
        },
        body: JSON.stringify({ hostToken, questions })
      });
      const data = await res.json();
      if (data.ok && data.roomPin) {
        await this.connectRoom('jury', data.roomPin, true);
      }
      return data;
    }

    async joinJuryRoom(roomPin, name) {
      const res = await fetch('/api/jury/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomPin, name, clientId: this.clientId })
      });
      const data = await res.json();
      if (data.ok) {
        await this.connectRoom('jury', roomPin, false);
      }
      return data;
    }

    async submitJuryVote(roomPin, optionIndex, reasoning) {
      const res = await fetch('/api/jury/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomPin,
          clientId: this.clientId,
          optionIndex,
          reasoning
        })
      });
      const data = await res.json();
      if (data.ok) {
        this.notifyChange();
      }
      return data;
    }

    async juryHostAction(roomPin, action) {
      const hostToken = getHostToken();
      const res = await fetch('/api/jury/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Host-Token': hostToken
        },
        body: JSON.stringify({ roomPin, action, hostToken })
      });
      const data = await res.json();
      if (data.ok) {
        this.notifyChange();
      }
      return data;
    }
  }

  // Export singleton instance
  window.realtimeSync = new RealtimeSyncManager();

})(window);
