// ═══════════════════════════════════════════════════════════
//  Supabase 設定  ── 請將下方兩個值替換為您的專案資訊
//  Dashboard → Settings → API
// ═══════════════════════════════════════════════════════════
const DB_URL     = 'https://ojwoqmpyxtcjemrnkorz.supabase.co';
const DB_ANON_KEY = 'sb_publishable_65S8BPgHlFHmRZHvmzxzyA_Ut7BViu6';

// ── 固定人名清單（訂購人 & 主購共用）───────────────────────
// 結構：{ name: '主要名稱', aliases: ['別名1', '別名2', ...] }
const MEMBER_LIST = [
  { name: '耕宇', aliases: ['耕宇'] },
  { name: '來毅', aliases: ['來毅'] },
  { name: '怡蒨', aliases: ['怡蒨', 'Edda', '怡蒨-Edda', 'edda'] },
  { name: '進成', aliases: ['進成', 'Andy', '主任', '進成主任'] },
  { name: '俊麟', aliases: ['俊麟'] },
  { name: '靜怡', aliases: ['靜怡', '林靜怡'] },
  { name: '宏明', aliases: ['宏明'] },
  { name: '威蓁', aliases: ['威蓁'] },
  { name: '瀞萱', aliases: ['瀞萱'] },
  { name: '培華', aliases: ['培華'] },
  { name: '廷毓', aliases: ['廷毓'] },
  { name: '銀燦', aliases: ['銀燦', 'stanny5', '銀燦-stanny5', 'Stanny5'] },
  { name: '育淇', aliases: ['育淇', '預期'] },
  { name: '亭諭', aliases: ['亭諭'] }
];

// ── 輔助函數：取得所有主要名稱的陣列 ──────────────────────
function getMemberNames() {
  return MEMBER_LIST.map(m => m.name);
}

// ── 輔助函數：建立別名到主名字的映射 ────────────────────
function buildAliasMap() {
  const map = new Map();
  for (const member of MEMBER_LIST) {
    for (const alias of member.aliases) {
      map.set(alias, member.name);
    }
  }
  return map;
}

const ALIAS_MAP = buildAliasMap();

// ── 低階 fetch helper ────────────────────────────────────
async function sbFetch(path, options = {}) {
  const url = `${DB_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey':        DB_ANON_KEY,
      'Authorization': `Bearer ${DB_ANON_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Restaurants API ──────────────────────────────────────
const RestaurantsAPI = {
  async getAll() {
    const rows = await sbFetch('restaurants?select=*&order=created_at.asc');
    return rows.map(dbToRestaurant);
  },
  async insert(r) {
    const rows = await sbFetch('restaurants', {
      method: 'POST',
      body:   JSON.stringify(restaurantToDB(r))
    });
    return dbToRestaurant(rows[0]);
  },
  async update(id, r) {
    const rows = await sbFetch(`restaurants?id=eq.${id}`, {
      method: 'PATCH',
      body:   JSON.stringify(restaurantToDB(r))
    });
    return rows ? dbToRestaurant(rows[0]) : null;
  },
  async delete(id) {
    await sbFetch(`restaurants?id=eq.${id}`, {
      method:  'DELETE',
      headers: { 'Prefer': 'return=minimal' }
    });
  }
};

// ── Orders API ───────────────────────────────────────────
const OrdersAPI = {
  async getAll() {
    const rows = await sbFetch('orders?select=*&order=order_date.desc');
    return rows.map(dbToOrder);
  },
  async getByRestaurant(restaurantId) {
    const rows = await sbFetch(`orders?restaurant_id=eq.${restaurantId}&select=*&order=order_date.desc`);
    return rows.map(dbToOrder);
  },
  async insert(o) {
    const rows = await sbFetch('orders', {
      method: 'POST',
      body:   JSON.stringify(orderToDB(o))
    });
    return dbToOrder(rows[0]);
  },
  async update(id, o) {
    const rows = await sbFetch(`orders?id=eq.${id}`, {
      method: 'PATCH',
      body:   JSON.stringify(orderToDB(o))
    });
    return rows ? dbToOrder(rows[0]) : null;
  },
  async delete(id) {
    await sbFetch(`orders?id=eq.${id}`, {
      method:  'DELETE',
      headers: { 'Prefer': 'return=minimal' }
    });
  },
  async markPaid(ids) {
    const inClause = `(${ids.join(',')})`;
    await sbFetch(`orders?id=in.${inClause}`, {
      method:  'PATCH',
      body:    JSON.stringify({ paid_status: '已付款' }),
      headers: { 'Prefer': 'return=minimal' }
    });
  }
};

// ── 欄位轉換 ─────────────────────────────────────────────
function restaurantToDB(r) {
  return {
    id:          r.id,
    name:        r.name,
    contact:     r.contact    || null,
    address:     r.address    || null,
    receiver:    r.receiver   || null,   // 主購
    service_fee: Number(r.serviceFee) || 0,  // 單位：元
    note:        r.note       || null
  };
}

function dbToRestaurant(row) {
  return {
    id:         row.id,
    name:       row.name,
    contact:    row.contact    || '',
    address:    row.address    || '',
    receiver:   row.receiver   || '',    // 主購
    serviceFee: Number(row.service_fee) || 0,  // 單位：元（每筆訂單固定加）
    note:       row.note       || '',
    createdAt:  row.created_at ? row.created_at.slice(0, 10) : ''
  };
}

function orderToDB(o) {
  return {
    id:            o.id,
    restaurant_id: o.restaurantId,
    orderer:       o.orderer,
    order_date:    o.orderDate  || null,
    items:         o.items      || null,
    amount:        Number(o.amount) || 0,
    paid_status:   o.paidStatus || '未付款',
    note:          o.note       || null
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
    note:         row.note        || ''
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

// serviceFee 現在是「固定元數」，直接回傳
function calcFee(serviceFee) {
  return Number(serviceFee) || 0;
}

// 訂單實際應付 = amount + serviceFee（固定元）
function totalWithFee(amount, serviceFee) {
  return Number(amount || 0) + calcFee(serviceFee);
}

// 產生人名下拉選單 HTML
function memberOptions(selectedValue = '') {
  return MEMBER_LIST.map(name =>
    `<option value="${esc(name)}" ${name === selectedValue ? 'selected' : ''}>${esc(name)}</option>`
  ).join('');
}

const AVATAR_COLORS = ['#2D7DD2','#1A9E5C','#E67E22','#8E44AD','#16A085','#C0392B','#2980B9','#D35400'];
function avatarColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFF;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
