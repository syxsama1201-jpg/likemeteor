/**
 * inventory.js — 库存管理专属逻辑
 * 依赖：common.js 必须先加载
 *
 * 卡片和表格的字段映射可根据飞书多维表格的实际字段名，
 * 修改下方的 FIELD_MAP 配置对象即可。
 */

// ==================== 字段映射配置（按你的飞书表格字段名修改） ====================
const FIELD_MAP = {
    // 卡片汇总字段
    '可售库存': '可售库存',
    '不可售库存': '不可售库存',
    '在途库存': '在途库存',
    '预留库存': '预留库存',
    '库存总额': '库存单价',       // 库存总额 = 可售库存 × 库存单价
    // 表格显示字段
    '商品名称': '商品名称',
    '产品图': '产品图',
    'SKU': 'SKU',
    'ASIN': 'ASIN',
    '库龄': '库龄',
    '周转天数': '周转天数',
    '最近入库日期': '最近入库日期',
};

// ==================== 库存页全局状态 ====================
let globalRecords = [];
let currentSort = { key: null, direction: 'none' };
let currentSearchTerm = '';

// ==================== 页面初始化 ====================

function onLoginSuccess() {
    fetchInventoryData();
}

document.addEventListener('DOMContentLoaded', function() {
    if (isLoggedIn()) {
        hideLoginOverlay();
        fetchInventoryData();
    } else {
        showLoginOverlay();
    }
});

// ==================== 数据获取 ====================

async function fetchInventoryData() {
    const token = getToken();
    if (!token) {
        showLoginOverlay();
        return;
    }
    try {
        const response = await fetch(API_BASE + '/api/inventory', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (response.status === 401) {
            clearAuth();
            showLoginOverlay();
            return;
        }
        const result = await response.json();
        if (result.status === 'success') {
            globalRecords = result.data;
            calculateAndRenderCards(globalRecords);
            handleSort('可售库存');
        } else {
            console.error("获取库存数据失败:", result);
        }
    } catch (error) {
        console.error("无法连接服务器:", error);
    }
}

// ==================== 卡片计算与渲染 ====================

function calculateAndRenderCards(records) {
    let totalSellable = 0, totalUnsellable = 0, totalInbound = 0;
    let totalReserved = 0, totalValue = 0, skuCount = 0;
    let alertCount = 0;
    const seenSku = new Set();

    records.forEach(record => {
        const f = record.fields;
        if (!f || Object.keys(f).length === 0) return;

        const sellable = parseInt(f[FIELD_MAP['可售库存']]) || 0;
        const unsellable = parseInt(f[FIELD_MAP['不可售库存']]) || 0;
        const inbound = parseInt(f[FIELD_MAP['在途库存']]) || 0;
        const reserved = parseInt(f[FIELD_MAP['预留库存']]) || 0;
        const unitPrice = parseFloat(f[FIELD_MAP['库存总额']]) || 0;

        totalSellable += sellable;
        totalUnsellable += unsellable;
        totalInbound += inbound;
        totalReserved += reserved;
        totalValue += sellable * unitPrice;

        const sku = f[FIELD_MAP['SKU']];
        if (sku && !seenSku.has(sku)) {
            seenSku.add(sku);
            skuCount++;
        }

        // 库存预警：可售库存 < 10 且 SKU 存在
        if (sellable < 10 && sku) {
            alertCount++;
        }
    });

    document.getElementById('card-sku-count').innerText = skuCount.toLocaleString();
    document.getElementById('card-sku-footer').innerHTML = `<span>活跃SKU</span><span>共 ${skuCount} 个</span>`;

    document.getElementById('card-sellable').innerText = totalSellable.toLocaleString();
    document.getElementById('card-sellable-footer').innerHTML = `<span>可售总量</span><span>${totalSellable.toLocaleString()} 件</span>`;

    document.getElementById('card-unsellable').innerText = totalUnsellable.toLocaleString();
    document.getElementById('card-unsellable-footer').innerHTML = `<span>不可售总量</span><span>${totalUnsellable.toLocaleString()} 件</span>`;

    document.getElementById('card-inbound').innerText = totalInbound.toLocaleString();
    document.getElementById('card-inbound-footer').innerHTML = `<span>在途总量</span><span>${totalInbound.toLocaleString()} 件</span>`;

    document.getElementById('card-total-value').innerText = `$${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('card-value-footer').innerHTML = `<span>可售库存估值</span><span class="trend-none">--</span>`;

    document.getElementById('card-alert-count').innerText = alertCount.toLocaleString();
    document.getElementById('card-alert-footer').innerHTML = alertCount > 0
        ? `<span>低库存商品</span><span class="trend-down">需补货</span>`
        : `<span>低库存商品</span><span class="trend-up">库存正常</span>`;
}

// ==================== 搜索 / 排序 ====================

function handleSearch(event) {
    currentSearchTerm = event.target.value.trim().toLowerCase();
    applyFilterAndSort();
}

function handleSort(key) {
    if (currentSort.key === key) {
        if (currentSort.direction === 'none') currentSort.direction = 'desc';
        else if (currentSort.direction === 'desc') currentSort.direction = 'asc';
        else currentSort.direction = 'none';
    } else {
        currentSort.key = key;
        currentSort.direction = 'desc';
    }
    document.querySelectorAll('.sort-icon').forEach(icon => { icon.className = 'sort-icon sort-none'; });
    const activeIcon = document.getElementById(`sort-icon-${key}`);
    if (activeIcon) {
        if (currentSort.direction === 'desc') activeIcon.className = 'sort-icon sort-desc';
        if (currentSort.direction === 'asc') activeIcon.className = 'sort-icon sort-asc';
    }
    applyFilterAndSort();
}

// ==================== 核心：过滤 + 排序 + 渲染 ====================

function applyFilterAndSort() {
    let processedRecords = [...globalRecords];

    // 1. 关键词过滤
    if (currentSearchTerm) {
        processedRecords = processedRecords.filter(record => {
            const f = record.fields;
            const name = (f[FIELD_MAP['商品名称']] || '').toLowerCase();
            const sku = (f[FIELD_MAP['SKU']] || '').toLowerCase();
            const asin = (f[FIELD_MAP['ASIN']] || '').toLowerCase();
            return name.includes(currentSearchTerm)
                || sku.includes(currentSearchTerm)
                || asin.includes(currentSearchTerm);
        });
    }

    // 2. 排序
    if (currentSort.direction !== 'none' && currentSort.key) {
        processedRecords.sort((a, b) => {
            const key = currentSort.key;
            let valA = parseFloat(a.fields[key]) || 0;
            let valB = parseFloat(b.fields[key]) || 0;
            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // 3. 渲染
    renderTable(processedRecords);
    document.getElementById('toolbar-total-count').innerText = `共 ${processedRecords.length} 条`;
}

// ==================== 表格渲染 ====================

function renderTable(records) {
    const tbody = document.querySelector('tbody');
    tbody.innerHTML = '';

    records.forEach(record => {
        const f = record.fields;
        if (!f || Object.keys(f).length === 0) return;

        // 产品图
        let imgHtml = '<div style="width:25px; height:25px; background-color:#f2f3f5; border-radius:2px;"></div>';
        if (f[FIELD_MAP['产品图']] && f[FIELD_MAP['产品图']].length > 0) {
            const rawFeishuImgUrl = f[FIELD_MAP['产品图']][0].url;
            const imgToken = getToken();
            imgHtml = `<img src="http://121.40.126.178:5000/api/image?url=${encodeURIComponent(rawFeishuImgUrl)}&_token=${encodeURIComponent(imgToken || '')}" loading="lazy" onerror="handleImageError(this)" style="width:25px; height:25px; object-fit:cover; border-radius:2px; display:block;">`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${f[FIELD_MAP['商品名称']] || '-'}</td>
            <td>${imgHtml}</td>
            <td>${f[FIELD_MAP['SKU']] || '-'}</td>
            <td>${f[FIELD_MAP['ASIN']] || '-'}</td>
            <td>${f[FIELD_MAP['可售库存']] || '0'}</td>
            <td>${f[FIELD_MAP['不可售库存']] || '0'}</td>
            <td>${f[FIELD_MAP['在途库存']] || '0'}</td>
            <td>${f[FIELD_MAP['预留库存']] || '0'}</td>
            <td>${f[FIELD_MAP['库龄']] || '-'}</td>
            <td>${f[FIELD_MAP['周转天数']] || '-'}</td>
            <td>${f[FIELD_MAP['最近入库日期']] || '-'}</td>
            <td class="action-link">详情</td>
        `;
        tbody.appendChild(tr);
    });

    // 表格渲染完成后初始化列宽拖拽
    if (window._initColumnResize) {
        window._initColumnResize();
    }
}
