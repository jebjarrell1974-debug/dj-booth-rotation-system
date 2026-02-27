const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

function createEntityStore(entityName) {
  const storageKey = `entity_${entityName}`;

  const getAll = () => {
    try {
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  };

  const saveAll = (items) => {
    localStorage.setItem(storageKey, JSON.stringify(items));
  };

  return {
    list: async () => {
      return getAll();
    },

    create: async (data) => {
      const items = getAll();
      const newItem = { id: generateId(), ...data, created_date: new Date().toISOString() };
      items.push(newItem);
      saveAll(items);
      return newItem;
    },

    update: async (id, data) => {
      const items = getAll();
      const index = items.findIndex(item => item.id === id);
      if (index === -1) throw new Error(`${entityName} not found: ${id}`);
      items[index] = { ...items[index], ...data };
      saveAll(items);
      return items[index];
    },

    delete: async (id) => {
      const items = getAll();
      const filtered = items.filter(item => item.id !== id);
      saveAll(filtered);
      return true;
    },

    filter: async (criteria) => {
      const items = getAll();
      return items.filter(item => {
        return Object.entries(criteria).every(([key, value]) => item[key] === value);
      });
    }
  };
}

const UPLOAD_DB_NAME = 'djUploadDB';
const UPLOAD_STORE_NAME = 'files';

const openUploadDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(UPLOAD_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(UPLOAD_STORE_NAME)) {
        db.createObjectStore(UPLOAD_STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

const DANCER_BACKUP_KEY = 'djbooth_dancer_backup';

function createServerDancerStore() {
  const getToken = () => sessionStorage.getItem('djbooth_token');
  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  const handle401 = (res) => {
    if (res.status === 401) {
      sessionStorage.removeItem('djbooth_token');
      sessionStorage.removeItem('djbooth_role');
      sessionStorage.removeItem('djbooth_dancer_id');
      sessionStorage.removeItem('djbooth_dancer_name');
      sessionStorage.removeItem('djbooth_remote');
      window.dispatchEvent(new Event('djbooth-session-expired'));
    }
  };

  const backupToLocal = (dancers) => {
    try {
      const backupData = dancers.map(d => ({
        name: d.name,
        color: d.color,
        playlist: d.playlist || [],
        is_active: d.is_active,
      }));
      localStorage.setItem(DANCER_BACKUP_KEY, JSON.stringify(backupData));
    } catch {}
  };

  return {
    list: async () => {
      const res = await fetch('/api/dancers', { headers: headers() });
      if (!res.ok) { handle401(res); return []; }
      const dancers = await res.json();
      if (Array.isArray(dancers) && dancers.length > 0) {
        backupToLocal(dancers);
      }
      return dancers;
    },
    create: async (data) => {
      const res = await fetch('/api/dancers', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        handle401(res);
        let msg = 'Failed to create dancer';
        try {
          const err = await res.json();
          if (err.error) msg = err.error;
        } catch (e) {}
        throw new Error(msg);
      }
      const created = await res.json();
      if (data.playlist && data.playlist.length > 0) {
        try {
          await fetch(`/api/dancers/${created.id}`, {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify({ playlist: data.playlist }),
          });
        } catch {}
      }
      return created;
    },
    update: async (id, data) => {
      const res = await fetch(`/api/dancers/${id}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(data),
      });
      if (!res.ok) { handle401(res); throw new Error('Failed to update dancer'); }
      return res.json();
    },
    delete: async (id) => {
      const res = await fetch(`/api/dancers/${id}`, {
        method: 'DELETE',
        headers: headers(),
      });
      if (res && !res.ok) handle401(res);
      return true;
    },
    filter: async (criteria) => {
      const all = await localEntities.Dancer.list();
      return all.filter(item =>
        Object.entries(criteria).every(([key, value]) => item[key] === value)
      );
    },
    saveBackup: (dancers) => backupToLocal(dancers),
    loadBackup: () => {
      try {
        const data = localStorage.getItem(DANCER_BACKUP_KEY);
        return data ? JSON.parse(data) : null;
      } catch { return null; }
    },
  };
}

export const localEntities = {
  Dancer: createServerDancerStore(),
  Stage: createEntityStore('stage'),
  AnnouncementCache: createEntityStore('announcement_cache'),
};

export const localIntegrations = {
  Core: {
    UploadFile: async ({ file }) => {
      const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const arrayBuffer = await file.arrayBuffer();
      const db = await openUploadDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(UPLOAD_STORE_NAME, 'readwrite');
        const store = tx.objectStore(UPLOAD_STORE_NAME);
        const request = store.put({
          id,
          data: arrayBuffer,
          type: file.type,
          name: file.name,
          timestamp: Date.now()
        });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
      return { file_url: `indexeddb://${id}` };
    },
    GetFileBlob: async (fileUrl) => {
      if (!fileUrl.startsWith('indexeddb://')) {
        return fileUrl;
      }
      const id = fileUrl.replace('indexeddb://', '');
      const db = await openUploadDB();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(UPLOAD_STORE_NAME, 'readonly');
        const store = tx.objectStore(UPLOAD_STORE_NAME);
        const request = store.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      if (!record) throw new Error('File not found in local storage');
      const blob = new Blob([record.data], { type: record.type });
      return URL.createObjectURL(blob);
    },
    InvokeLLM: async ({ prompt }) => {
      const { getApiConfig } = await import('@/components/apiConfig');
      const config = getApiConfig();
      
      if (config.openaiApiKey) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20000);
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.openaiApiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'user', content: prompt }
              ],
              max_tokens: 500
            }),
            signal: controller.signal
          });
          clearTimeout(timeout);
          if (!response.ok) {
            const status = response.status;
            if (status === 401) throw new Error('Invalid OpenAI API key');
            throw new Error(`OpenAI API error (${status})`);
          }
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (typeof content === 'string') return content;
          return String(content ?? '');
        } catch (error) {
          console.error('OpenAI API error:', error.message);
          throw error;
        }
      }
      
      return prompt.includes('STAGE INTRODUCTION') 
        ? 'Coming to the main stage right now, get those eyes up and get ready. Show her some love and make it rain.'
        : prompt.includes('STAGE TRANSITION') 
        ? 'That was incredible. She is available for VIP right now if you want that one-on-one time. Meanwhile, keep your eyes on the main stage because we have another beauty coming your way.'
        : prompt.includes('STAGE EXIT')
        ? 'Give it up one more time. She just left it all on that stage. She is available for VIP right now, so if you liked what you saw, go see her.'
        : 'She is still going on the main stage. Do not let up. Keep those tips coming.';
    }
  }
};
