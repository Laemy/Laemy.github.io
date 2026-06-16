// ═══════════════════════════════════════════════════════════
//  Supabase 設定  ── 請將下方兩個值替換為您的專案資訊
//  Dashboard → Settings → API
// ═══════════════════════════════════════════════════════════
const SUPABASE_URL     = 'https://ojwoqmpyxtcjemrnkorz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_65S8BPgHlFHmRZHvmzxzyA_Ut7BViu6';


// ── 欄位對應（DB snake_case ↔ JS camelCase）──────────────
// restaurants: id, name, contact, address, receiver, service_fee, note, created_at
// orders:      id, restaurant_id, orderer, order_date, items, amount, paid_status, note

// ── 低階 fetch helper ────────────────────────────────────
async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  // 204 No Content → return null
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Restaurants API ──────────────────────────────────────
const RestaurantsAPI = {
  // 取得所有餐廳（依建立時間排序）
  async getAll() {
    const rows = await sbFetch('restaurants?select=*&order=created_at.asc');
    return rows.map(dbToRestaurant);
  },

  // 新增餐廳
  async insert(r) {
    const rows = await sbFetch('restaurants', {
      method: 'POST',
      body: JSON.stringify(restaurantToDB(r))
    });
    return dbToRestaurant(rows[0]);
  },

  // 更新餐廳
  async update(id, r) {
    const rows = await sbFetch(`restaurants?id=eq.${id}`, {
      method:  'PATCH',
      body:    JSON.stringify(restaurantToDB(r))
    });
    return rows ? dbToRestaurant(rows[0]) : null;
  },

  // 刪除餐廳（orders 會 cascade 刪除）
  async delete(id) {
    await sbFetch(`restaurants?id=eq.${id}`, {
      method:  'DELETE',
      prefer:  'return=minimal',
      headers: { 'Prefer': 'return=minimal' }
    });
  }
};

// ── Orders API ───────────────────────────────────────────
const OrdersAPI = {
  // 取得所有訂單
  async getAll() {
    const rows = await sbFetch('orders?select=*&order=order_date.desc');
    return rows.map(dbToOrder);
  },

  // 取得特定餐廳的訂單
  async getByRestaurant(restaurantId) {
    const rows = await sbFetch(`orders?restaurant_id=eq.${restaurantId}&select=*&order=order_date.desc`);
    return rows.map(dbToOrder);
  },

  // 新增訂單
  async insert(o) {
    const rows = await sbFetch('orders', {
      method: 'POST',
      body:   JSON.stringify(orderToDB(o))
    });
    return dbToOrder(rows[0]);
  },

  // 更新訂單
  async update(id, o) {
    const rows = await sbFetch(`orders?id=eq.${id}`, {
      method: 'PATCH',
      body:   JSON.stringify(orderToDB(o))
    });
    return rows ? dbToOrder(rows[0]) : null;
  },

  // 刪除訂單
  async delete(id) {
    await sbFetch(`orders?id=eq.${id}`, {
      method:  'DELETE',
      headers: { 'Prefer': 'return=minimal' }
    });
  },

  // 批次更新付款狀態（傳入 id 陣列）
  async markPaid(ids) {
    // Supabase REST: id=in.(id1,id2,...)
    const inClause = `(${ids.join(',')})`;
    await sbFetch(`orders?id=in.${inClause}`, {
      method: 'PATCH',
      body:   JSON.stringify({ paid_status: '已付款' }),
      headers: { 'Prefer': 'return=minimal' }
    });
  }
};

// ── 欄位轉換 ─────────────────────────────────────────────
function restaurantToDB(r) {
  return {
    id:          r.id,
    name:        r.name,
    contact:     r.contact     || null,
    address:     r.address     || null,
    receiver:    r.receiver    || null,
    service_fee: Number(r.serviceFee) || 0,
    note:        r.note        || null
    // created_at 由 DB default 處理，不傳
  };
}

function dbToRestaurant(row) {
  return {
    id:         row.id,
    name:       row.name,
    contact:    row.contact     || '',
    address:    row.address     || '',
    receiver:   row.receiver    || '',
    serviceFee: Number(row.service_fee) || 0,
    note:       row.note        || '',
    createdAt:  row.created_at ? row.created_at.slice(0,10) : ''
  };
}

function orderToDB(o) {
  return {
    id:            o.id,
    restaurant_id: o.restaurantId,
    orderer:       o.orderer,
    order_date:    o.orderDate   || null,
    items:         o.items       || null,
    amount:        Number(o.amount) || 0,
    paid_status:   o.paidStatus  || '未付款',
    note:          o.note        || null
  };
}

function dbToOrder(row) {
  return {
    id:           row.id,
    restaurantId: row.restaurant_id,
    orderer:      row.orderer,
    orderDate:    row.order_date || '',
    items:        row.items      || '',
    amount:       Number(row.amount) || 0,
    paidStatus:   row.paid_status || '未付款',
    note:         row.note       || ''
  };
}

// ── ID 產生 ───────────────────────────────────────────────
function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// ── 工具函式 ──────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function calcFee(amount, pct) {
  return Math.round(Number(amount || 0) * Number(pct || 0) / 100);
}

const AVATAR_COLORS = ['#2D7DD2','#1A9E5C','#E67E22','#8E44AD','#16A085','#C0392B','#2980B9','#D35400'];
function avatarColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFF;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
