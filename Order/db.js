// ═══════════════════════════════════════════════════════════
//  Supabase 設定  ── 請將下方兩個值替換為您的專案資訊
//  Dashboard → Settings → API
// ═══════════════════════════════════════════════════════════
const DB_URL     = 'https://ojwoqmpyxtcjemrnkorz.supabase.co';
const DB_ANON_KEY = 'sb_publishable_65S8BPgHlFHmRZHvmzxzyA_Ut7BViu6';

// ═══════════════════════════════════════════════════════════
//  【新增功能】菜單維護 + 點餐頁 + 開團整合 —— DB Schema 異動
//  請在 Supabase SQL Editor 執行以下 SQL 來新增/調整資料表
// ═══════════════════════════════════════════════════════════
/*

-- 1) 新表：menus（菜單主檔／菜單總名）
create table menus (
  id         text primary key,
  name       text not null,           -- 菜單總名，例如「丸龜製麵菜單」
  note       text,
  created_at timestamptz default now()
);

-- 2) 新表：menu_items（菜單品項：菜名 / 口味 / 金額）
create table menu_items (
  id         text primary key,
  menu_id    text not null references menus(id) on delete cascade,
  dish_name  text not null,           -- 菜名
  flavor     text,                    -- 口味（可選，例如「原味」「大辣」）
  price      numeric not null default 0,   -- 金額
  sort_order int default 0,           -- 顯示排序
  created_at timestamptz default now()
);
create index idx_menu_items_menu_id on menu_items(menu_id);

-- 3) restaurants 表新增欄位：menu_id（開團時可選擇對應菜單，非必填）
alter table restaurants add column menu_id text references menus(id);

-- 3-1) restaurants 表新增欄位：is_locked（結單鎖定，鎖定後不可再新增/修改訂單）
alter table restaurants add column is_locked boolean default false;

-- 4) orders 表新增欄位：items_detail（結構化品項 JSON，來自點餐頁的菜單勾選）
--    例如：[{"dishName":"紫米飯糰","flavor":"原味","price":70,"qty":2}, ...]
--    仍保留原有 items（文字描述）欄位，供對帳頁 / 批量匯入等既有流程相容使用
alter table orders add column items_detail jsonb;

【欄位設計理念】
- menus / menu_items 為「可重複使用」的菜單樣板，不綁定單次開團，
  同一家實體餐廳若多次開團，可重複套用同一份菜單，也可以不套用（保留手動輸入 items/amount 的彈性）。
- restaurants.menu_id 是「這次開團」對應的菜單（可選，NULL 代表這次開團採手動輸入品項，
  沿用原有的批量匯入 / 手動新增訂單流程）。
- restaurants.is_locked 是「結單」開關：鎖定後，點餐頁（order.html）不再允許新增或修改/刪除訂單，
  但既有訂單的「標記已付款」對帳流程不受影響，仍可正常結帳。
- orders.items_detail 只在「點餐頁（order.html）」透過菜單勾選送出訂單時才會填入，
  其餘管道（手動新增、批量匯入 LINE 訊息）維持 NULL，並仍以 items 文字欄位描述品項，
  確保整個對帳系統（index.html / restaurant.html / reconcile.html）完全不需修改即可正常運作，
  因為這些頁面只依賴 orders.amount / orders.items / orders.paidStatus。
- order-summary.html（開團整合頁）會優先使用 items_detail 做「品項加總」，
  若該筆訂單沒有 items_detail（例如手動輸入或批量匯入），則該筆只會出現在「依人明細」，
  不會被計入品項加總表。

*/


// ── 固定人名清單（訂購人 & 主購共用）───────────────────────
// 結構：{ name: '主要名稱', aliases: ['別名1', '別名2', ...] }
const MEMBER_LIST = [
  { name: '耕宇', aliases: ['耕宇','耕','宇'] },
  { name: '來毅', aliases: ['來毅','來','毅'] },
  { name: '怡蒨', aliases: ['怡蒨', 'Edda', '怡蒨-Edda', 'edda'] },
  { name: '進成', aliases: ['進成', 'Andy', '主任', '進成主任','Andy Yang(進成)'] },
  { name: '俊麟', aliases: ['俊麟','郭課','俊麟課長','access','郭'] },
  { name: '靜怡', aliases: ['靜怡', '林靜怡', '靜怡課長','靜'] },
  { name: '宏明', aliases: ['宏明','宏'] },
  { name: '威蓁', aliases: ['威蓁','威'] },
  { name: '瀞萱', aliases: ['瀞萱','Monica','萱','宣'] },
  { name: '培華', aliases: ['培華','PeiHua','培'] },
  { name: '廷毓', aliases: ['廷毓','Nick Chang廷毓','Nick','廷'] },
  { name: '銀燦', aliases: ['銀燦', 'stanny5', '銀燦-stanny5', 'Stanny5', 'Stanny'] },
  { name: '育淇', aliases: ['育淇', '預期', '育其', 'yuqi'] },
  { name: '亭諭', aliases: ['亭諭','小亭'] },
  { name: '暉文', aliases: ['黃暉文','文'] },
  { name: '景斌', aliases: ['莊景斌 Benjamin','Benjamin','景斌','莊景斌','景'] }
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

// ── Menus API（菜單主檔）─────────────────────────────────
const MenusAPI = {
  async getAll() {
    const rows = await sbFetch('menus?select=*&order=created_at.asc');
    return rows.map(dbToMenu);
  },
  async insert(m) {
    const rows = await sbFetch('menus', { method: 'POST', body: JSON.stringify(menuToDB(m)) });
    return dbToMenu(rows[0]);
  },
  async update(id, m) {
    const rows = await sbFetch(`menus?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(menuToDB(m)) });
    return rows ? dbToMenu(rows[0]) : null;
  },
  async delete(id) {
    // 刪除菜單前，先刪除所屬品項（避免外鍵限制）
    await MenuItemsAPI.deleteByMenu(id);
    await sbFetch(`menus?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
  }
};

// ── Menu Items API（菜單品項：菜名 / 口味 / 金額）──────────
const MenuItemsAPI = {
  async getAll() {
    const rows = await sbFetch('menu_items?select=*&order=sort_order.asc');
    return rows.map(dbToMenuItem);
  },
  async getByMenu(menuId) {
    const rows = await sbFetch(`menu_items?menu_id=eq.${menuId}&select=*&order=sort_order.asc`);
    return rows.map(dbToMenuItem);
  },
  async insert(item) {
    const rows = await sbFetch('menu_items', { method: 'POST', body: JSON.stringify(menuItemToDB(item)) });
    return dbToMenuItem(rows[0]);
  },
  async insertMany(items) {
    if (!items.length) return [];
    const rows = await sbFetch('menu_items', { method: 'POST', body: JSON.stringify(items.map(menuItemToDB)) });
    return rows.map(dbToMenuItem);
  },
  async update(id, item) {
    const rows = await sbFetch(`menu_items?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(menuItemToDB(item)) });
    return rows ? dbToMenuItem(rows[0]) : null;
  },
  async delete(id) {
    await sbFetch(`menu_items?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
  },
  async deleteByMenu(menuId) {
    await sbFetch(`menu_items?menu_id=eq.${menuId}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
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
    note:        r.note       || null,
    menu_id:     r.menuId     || null,   // 對應菜單（可選）
    is_locked:   !!r.locked              // 結單鎖定
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
    menuId:     row.menu_id    || '',    // 對應菜單（可選）
    locked:     !!row.is_locked,         // 結單鎖定
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
    note:          o.note       || null,
    items_detail:  o.itemsDetail || null   // 結構化品項（來自點餐頁的菜單選擇）
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
    note:         row.note        || '',
    itemsDetail:  row.items_detail || null
  };
}

function menuToDB(m) {
  return { id: m.id, name: m.name, note: m.note || null };
}
function dbToMenu(row) {
  return { id: row.id, name: row.name, note: row.note || '', createdAt: row.created_at ? row.created_at.slice(0,10) : '' };
}
function menuItemToDB(it) {
  return {
    id:         it.id,
    menu_id:    it.menuId,
    dish_name:  it.dishName,
    flavor:     it.flavor || null,
    price:      Number(it.price) || 0,
    sort_order: Number(it.sortOrder) || 0
  };
}
function dbToMenuItem(row) {
  return {
    id:        row.id,
    menuId:    row.menu_id,
    dishName:  row.dish_name,
    flavor:    row.flavor || '',
    price:     Number(row.price) || 0,
    sortOrder: Number(row.sort_order) || 0
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
