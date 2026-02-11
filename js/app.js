// ========================================
// ShareCalc - 쉐어하우스 공용비용 정산기
// 핵심 애플리케이션 로직
// ========================================
//
// 구조:
// 1. 상태 관리 - 입주자, 비용 데이터
// 2. 유틸리티 함수 - 날짜 계산, 포맷팅
// 3. 핵심 계산 로직 - 일할 비용 분담 엔진
// 4. UI 렌더링 - 화면 표시
// 5. 이벤트 핸들러 - 사용자 상호작용
// 6. 데이터 저장/불러오기 - localStorage
// 7. 초기화 - 앱 시작
// ========================================

'use strict';

// ========================================
// 1. 상태 관리
// ========================================

// 현재 로그인된 프로필
var currentProfile = null;

// 앱의 모든 데이터는 이 state 객체에 저장됩니다.
let state = {
    residents: [],
    expenses: [],
    history: [],   // 정산 이력
    nextId: 1
};

// ========================================
// 2. 유틸리티 함수
// ========================================

/**
 * 고유 ID를 생성합니다.
 * 입주자와 비용 항목을 구분하기 위해 사용됩니다.
 */
function generateId() {
    return state.nextId++;
}

/**
 * 날짜 문자열(YYYY-MM-DD)을 Date 객체로 변환합니다.
 * 시간대 문제를 방지하기 위해 T00:00:00을 붙입니다.
 *
 * ⚠️ 왜 이렇게 하는지:
 * new Date('2024-01-15')는 UTC로 해석되어 한국 시간과 차이가 날 수 있습니다.
 * 'T00:00:00'을 붙이면 로컬 시간으로 해석됩니다.
 */
function parseDate(dateStr) {
    return new Date(dateStr + 'T00:00:00');
}

/**
 * 두 날짜 사이의 일수를 계산합니다 (시작일, 종료일 모두 포함).
 *
 * 예시: 1월 1일 ~ 1월 31일 = 31일
 * 예시: 3월 5일 ~ 4월 4일 = 31일
 */
function getDayCount(startStr, endStr) {
    const start = parseDate(startStr);
    const end = parseDate(endStr);
    const diffMs = end.getTime() - start.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 because both dates inclusive
}

/**
 * 청구 기간의 매일을 순회하며 콜백 함수를 실행합니다.
 *
 * 이것이 정산의 핵심 원리입니다:
 * 매일매일 "그날 거주한 사람이 누구인지"를 판단하여
 * 그날의 비용을 그 사람들끼리만 나누는 것입니다.
 *
 * @param {string} startStr - 시작일 (YYYY-MM-DD)
 * @param {string} endStr - 종료일 (YYYY-MM-DD)
 * @param {function} callback - 각 날짜에 대해 실행할 함수 (날짜 문자열을 인자로 받음)
 */
function forEachDay(startStr, endStr, callback) {
    const start = parseDate(startStr);
    const end = parseDate(endStr);
    const current = new Date(start);

    while (current <= end) {
        // 날짜를 YYYY-MM-DD 형식 문자열로 변환
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');
        callback(`${year}-${month}-${day}`);
        current.setDate(current.getDate() + 1);
    }
}

/**
 * 숫자를 원화 형식으로 포맷합니다.
 * 예: 125340 → "125,340원"
 */
function formatCurrency(amount) {
    return Math.round(amount).toLocaleString('ko-KR') + '원';
}

/**
 * 10원 단위로 반올림합니다.
 * 쉐어하우스에서 1원 단위까지 정산하는 것은 비현실적이므로
 * 10원 단위로 반올림하는 것이 일반적입니다.
 * 예: 12,345원 → 12,350원
 */
function roundTo10(amount) {
    return Math.round(amount / 10) * 10;
}

/**
 * 날짜를 읽기 쉬운 형식으로 변환합니다.
 * 예: "2024-01-15" → "1/15"
 */
function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    return parseInt(parts[1]) + '/' + parseInt(parts[2]);
}

/**
 * 날짜를 전체 형식으로 변환합니다.
 * 예: "2024-01-15" → "2024.01.15"
 */
function formatDateFull(dateStr) {
    if (!dateStr) return '';
    return dateStr.replace(/-/g, '.');
}

// ========================================
// 3. 핵심 계산 로직 ★★★
// ========================================
//
// 이 함수가 이 서비스의 핵심입니다.
//
// [계산 원리]
// 1) 각 비용 항목의 청구 기간을 "일 단위"로 쪼갭니다.
//    예: 전기세 120,000원, 1/5~2/4 (31일간)
//    → 1일당 전기세 = 120,000 / 31 = 약 3,871원
//
// 2) 매일마다 "그날 집에 살고 있던 사람"을 찾습니다.
//    예: 1/15에 김철수, 이영희, 박민수 3명이 거주
//    → 이 날 전기세 1인당 = 3,871 / 3 = 약 1,290원
//
// 3) 이를 청구 기간 전체에 걸쳐 합산하면
//    각 입주자의 최종 부담액이 산출됩니다.
//
// 이 방식의 장점:
// - 입퇴실일이 다른 입주자도 정확하게 계산
// - 월 중간에 입퇴실해도 일할 계산 자동 적용
// - 비용별로 청구 기간이 달라도 문제없음
//

/**
 * 모든 비용에 대한 입주자별 분담액을 계산합니다.
 *
 * [계산 원리 - 공실 비용 처리]
 * 아무도 거주하지 않는 날의 비용은 운영자가 부담하지 않고,
 * 해당 비용 기간 내 거주한 모든 입주자가 거주일수 비율로 균등 분담합니다.
 *
 * @returns {object} {
 *   results: { [id]: { name, total, totalDays, expenses: [...] } },
 *   details: [ { name, amount, startDate, endDate, shares, vacantDays } ],
 *   totalExpense: number,
 *   transfers: [{from, to, amount}]
 * }
 */
function calculate() {
    const results = {};
    const details = [];
    let totalExpense = 0;

    // 각 입주자의 총 부담액을 0으로 초기화
    state.residents.forEach(function(r) {
        results[r.id] = {
            name: r.name,
            total: 0,
            totalDays: 0,
            expenses: []
        };
    });

    // ─── 각 비용 항목별로 일할 계산 수행 ───
    state.expenses.forEach(function(expense) {
        totalExpense += expense.amount;

        var expenseDetail = {
            name: expense.name,
            amount: expense.amount,
            startDate: expense.startDate,
            endDate: expense.endDate,
            shares: {},
            vacantDays: 0
        };

        var totalDays = getDayCount(expense.startDate, expense.endDate);
        var dailyCost = expense.amount / totalDays;

        // 각 입주자의 분담 정보 초기화
        state.residents.forEach(function(r) {
            expenseDetail.shares[r.id] = { days: 0, amount: 0 };
        });

        // 공실 일수 카운트용
        var vacantDays = 0;
        var vacantCost = 0;

        // ★ 1차: 매일을 순회하며 거주자가 있는 날의 비용 분할
        forEachDay(expense.startDate, expense.endDate, function(dateStr) {
            var presentResidents = state.residents.filter(function(r) {
                var afterMoveIn = dateStr >= r.moveInDate;
                var beforeMoveOut = !r.moveOutDate || dateStr <= r.moveOutDate;
                return afterMoveIn && beforeMoveOut;
            });

            if (presentResidents.length === 0) {
                vacantDays++;
                vacantCost += dailyCost;
            } else {
                var perPerson = dailyCost / presentResidents.length;
                presentResidents.forEach(function(r) {
                    expenseDetail.shares[r.id].days++;
                    expenseDetail.shares[r.id].amount += perPerson;
                });
            }
        });

        expenseDetail.vacantDays = vacantDays;

        // ★ 2차: 공실 비용을 거주일수 비율로 재분배
        // 아무도 없는 날의 비용은 해당 기간 내 거주한 입주자들이 비율대로 나눠 부담
        if (vacantCost > 0) {
            var totalPresenceDays = 0;
            state.residents.forEach(function(r) {
                totalPresenceDays += expenseDetail.shares[r.id].days;
            });

            if (totalPresenceDays > 0) {
                state.residents.forEach(function(r) {
                    var share = expenseDetail.shares[r.id];
                    if (share.days > 0) {
                        var ratio = share.days / totalPresenceDays;
                        share.amount += vacantCost * ratio;
                    }
                });
            }
        }

        // results에 합산
        state.residents.forEach(function(r) {
            var share = expenseDetail.shares[r.id];
            if (share.amount > 0) {
                results[r.id].total += share.amount;
                results[r.id].totalDays += share.days;
                results[r.id].expenses.push({
                    name: expense.name,
                    days: share.days,
                    amount: share.amount
                });
            }
        });

        details.push(expenseDetail);
    });

    var transfers = calculateTransfers(results);

    return {
        results: results,
        details: details,
        totalExpense: totalExpense,
        transfers: transfers
    };
}

/**
 * 최적화된 송금 정산을 계산합니다.
 * 각 입주자가 부담해야 할 금액과 실제 지불한 금액의 차이를 기반으로
 * 최소 횟수의 송금으로 정산할 수 있는 방법을 계산합니다.
 *
 * 여기서는 "1명이 전체 비용을 대납한 경우"를 가정합니다.
 * 지정된 대납자(또는 첫 번째 입주자)에게 각자 자기 몫을 보내면 됩니다.
 *
 * @returns {Array} [{from: string, to: string, amount: number}]
 */
function calculateTransfers(results) {
    var residentIds = Object.keys(results);
    if (residentIds.length <= 1) return [];

    // 각 입주자의 10원 단위 반올림된 부담액 수집
    var shares = [];
    residentIds.forEach(function(id) {
        var r = results[id];
        shares.push({
            id: id,
            name: r.name,
            amount: roundTo10(r.total)
        });
    });

    // 부담액이 가장 큰 사람 = 대납자로 가정
    // (일반적으로 쉐어하우스에서 집주인이나 관리자가 대납)
    shares.sort(function(a, b) { return b.amount - a.amount; });
    var payee = shares[0]; // 대납자

    var transfers = [];
    for (var i = 1; i < shares.length; i++) {
        if (shares[i].amount > 0) {
            transfers.push({
                from: shares[i].name,
                to: payee.name,
                amount: shares[i].amount
            });
        }
    }

    return transfers;
}

// ========================================
// 4. UI 렌더링
// ========================================

/**
 * 입주자 목록을 화면에 렌더링합니다.
 * 입주자를 추가/삭제할 때마다 호출됩니다.
 */
function renderResidents() {
    var container = document.getElementById('residents-list');
    container.innerHTML = '';

    state.residents.forEach(function(resident, index) {
        var div = document.createElement('div');
        div.className = 'form-item form-item--resident';
        div.innerHTML =
            '<button type="button" class="btn-delete" data-type="resident" data-id="' + resident.id + '" title="' + escapeHtml(resident.name || '입주자') + ' 삭제" aria-label="' + escapeHtml(resident.name || '입주자') + ' 삭제">&times;</button>' +
            '<div class="field">' +
                '<label>이름</label>' +
                '<input type="text" value="' + escapeHtml(resident.name) + '" placeholder="예: 홍길동" data-field="name" data-id="' + resident.id + '" data-type="resident">' +
            '</div>' +
            '<div class="field">' +
                '<label>입실일</label>' +
                '<input type="date" value="' + resident.moveInDate + '" data-field="moveInDate" data-id="' + resident.id + '" data-type="resident">' +
            '</div>' +
            '<div class="field">' +
                '<label>퇴실일 <span style="font-weight:400;color:var(--text-muted)">(선택)</span></label>' +
                '<input type="date" value="' + resident.moveOutDate + '" data-field="moveOutDate" data-id="' + resident.id + '" data-type="resident">' +
            '</div>';
        container.appendChild(div);
    });
}

/**
 * 비용 항목 목록을 화면에 렌더링합니다.
 * 비용을 추가/삭제할 때마다 호출됩니다.
 */
function renderExpenses() {
    var container = document.getElementById('expenses-list');
    container.innerHTML = '';

    // 자주 사용하는 비용 항목 프리셋
    var presetOptions =
        '<option value="">직접 입력</option>' +
        '<option value="전기세">전기세</option>' +
        '<option value="가스비">가스비</option>' +
        '<option value="수도세">수도세</option>' +
        '<option value="관리비">관리비</option>' +
        '<option value="인터넷">인터넷</option>' +
        '<option value="렌탈비">렌탈비</option>';

    state.expenses.forEach(function(expense) {
        var div = document.createElement('div');
        div.className = 'form-item form-item--expense';

        // 프리셋에 있는 항목인지 확인하여 선택 상태 설정
        var presets = ['전기세', '가스비', '수도세', '관리비', '인터넷', '렌탈비'];
        var isPreset = presets.indexOf(expense.name) !== -1;

        div.innerHTML =
            '<button type="button" class="btn-delete" data-type="expense" data-id="' + expense.id + '" title="' + escapeHtml(expense.name || '비용') + ' 삭제" aria-label="' + escapeHtml(expense.name || '비용') + ' 삭제">&times;</button>' +
            '<div class="field">' +
                '<label>항목</label>' +
                (isPreset
                    ? '<select data-field="name" data-id="' + expense.id + '" data-type="expense">' +
                      presetOptions.replace('value="' + expense.name + '"', 'value="' + expense.name + '" selected') +
                      '</select>'
                    : '<input type="text" value="' + escapeHtml(expense.name) + '" placeholder="예: 전기세" data-field="name" data-id="' + expense.id + '" data-type="expense">'
                ) +
            '</div>' +
            '<div class="field">' +
                '<label>청구 금액</label>' +
                '<input type="number" value="' + (expense.amount || '') + '" placeholder="0" min="0" data-field="amount" data-id="' + expense.id + '" data-type="expense">' +
            '</div>' +
            '<div class="field">' +
                '<label>청구 시작일</label>' +
                '<input type="date" value="' + expense.startDate + '" data-field="startDate" data-id="' + expense.id + '" data-type="expense">' +
            '</div>' +
            '<div class="field">' +
                '<label>청구 종료일</label>' +
                '<input type="date" value="' + expense.endDate + '" data-field="endDate" data-id="' + expense.id + '" data-type="expense">' +
            '</div>';
        container.appendChild(div);
    });
}

/**
 * 계산 결과를 화면에 렌더링합니다.
 */
function renderResults(calcResult) {
    var section = document.getElementById('results-section');
    var content = document.getElementById('results-content');

    // ─── 총 비용 요약 ───
    var html = '<div class="result-total">';
    html += '총 공용비용 <strong>' + formatCurrency(calcResult.totalExpense) + '</strong>';
    html += '</div>';

    // ─── 인별 요약 카드 ───
    html += '<div class="result-summary">';
    var residentIds = Object.keys(calcResult.results);
    residentIds.forEach(function(id) {
        var r = calcResult.results[id];
        var roundedAmount = roundTo10(r.total);
        html += '<div class="result-person">';
        html += '<div class="result-person__name">' + escapeHtml(r.name) + '</div>';
        html += '<div class="result-person__amount">' + formatCurrency(roundedAmount) + '</div>';
        html += '</div>';
    });
    html += '</div>';

    // ─── 공실 안내 (공실이 있는 경우에만 표시) ───
    var hasVacant = calcResult.details.some(function(d) { return d.vacantDays > 0; });
    if (hasVacant) {
        html += '<div class="vacant-info">';
        html += '<span class="vacant-info__icon">&#8505;</span>';
        html += '<span>공실 기간 비용은 거주 중인 입주자들이 거주일수 비율로 분담합니다.</span>';
        html += '</div>';
    }

    // ─── 비용 항목별 상세 내역 ───
    html += '<div class="result-detail">';
    html += '<h3>상세 내역</h3>';

    calcResult.details.forEach(function(detail) {
        html += '<div class="detail-expense">';
        html += '<div class="detail-expense__header">';
        html += '<div>';
        html += '<span class="detail-expense__name">' + escapeHtml(detail.name) + '</span>';
        html += ' <span class="detail-expense__period">' + formatDateShort(detail.startDate) + '~' + formatDateShort(detail.endDate) + '</span>';
        html += '</div>';
        html += '<span class="detail-expense__amount">' + formatCurrency(detail.amount) + '</span>';
        html += '</div>';

        html += '<div class="detail-expense__breakdown">';
        // 각 입주자의 분담 내역
        state.residents.forEach(function(r) {
            var share = detail.shares[r.id];
            if (share && share.amount > 0) {
                html += '<div class="detail-row">';
                html += '<span class="detail-row__name">' + escapeHtml(r.name) + '</span>';
                html += '<div class="detail-row__info">';
                html += '<span class="detail-row__days">' + share.days + '일</span>';
                html += '<span class="detail-row__amount">' + formatCurrency(roundTo10(share.amount)) + '</span>';
                html += '</div>';
                html += '</div>';
            }
        });

        // 공실 일수 표시 (비용은 거주자에 재분배됨)
        if (detail.vacantDays > 0) {
            html += '<div class="detail-row detail-row--vacant">';
            html += '<span class="detail-row__name" style="color:var(--text-muted)">공실 ' + detail.vacantDays + '일 (거주자 분담)</span>';
            html += '</div>';
        }

        html += '</div>'; // breakdown
        html += '</div>'; // detail-expense
    });

    html += '</div>'; // result-detail

    // ─── 송금 안내 ───
    if (calcResult.transfers && calcResult.transfers.length > 0) {
        html += '<div class="transfer-section">';
        html += '<h3>송금 안내</h3>';
        html += '<p class="transfer-desc">각자 부담할 금액을 아래와 같이 송금하면 정산이 완료됩니다.</p>';
        html += '<div class="transfer-list">';
        calcResult.transfers.forEach(function(t) {
            html += '<div class="transfer-item">';
            html += '<span class="transfer-from">' + escapeHtml(t.from) + '</span>';
            html += '<span class="transfer-arrow">&rarr;</span>';
            html += '<span class="transfer-to">' + escapeHtml(t.to) + '</span>';
            html += '<span class="transfer-amount">' + formatCurrency(t.amount) + '</span>';
            html += '</div>';
        });
        html += '</div>';
        html += '</div>';
    }

    // 반올림 안내
    html += '<div class="rounding-note">※ 모든 금액은 10원 단위로 반올림되었습니다.</div>';

    content.innerHTML = html;
    section.style.display = '';

    // 결과 영역으로 스크롤
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * XSS 방지를 위해 HTML 특수문자를 이스케이프합니다.
 */
function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ========================================
// 5. 이벤트 핸들러
// ========================================

/**
 * 입주자 추가
 */
function addResident() {
    state.residents.push({
        id: generateId(),
        name: '',
        moveInDate: '',
        moveOutDate: ''
    });
    renderResidents();
    saveToStorage();

    // 마지막으로 추가된 입주자의 이름 필드에 포커스
    var inputs = document.querySelectorAll('#residents-list .form-item:last-child input[data-field="name"]');
    if (inputs.length > 0) inputs[0].focus();
}

/**
 * 비용 항목 추가
 */
function addExpense() {
    state.expenses.push({
        id: generateId(),
        name: '',
        amount: 0,
        startDate: '',
        endDate: ''
    });
    renderExpenses();
    saveToStorage();

    // 마지막으로 추가된 비용의 항목명 필드에 포커스
    var fields = document.querySelectorAll('#expenses-list .form-item:last-child [data-field="name"]');
    if (fields.length > 0) fields[0].focus();
}

/**
 * 항목 삭제 (입주자 또는 비용)
 */
function deleteItem(type, id) {
    id = parseInt(id);
    if (type === 'resident') {
        state.residents = state.residents.filter(function(r) { return r.id !== id; });
        renderResidents();
    } else {
        state.expenses = state.expenses.filter(function(e) { return e.id !== id; });
        renderExpenses();
    }
    saveToStorage();
}

/**
 * 필드값 변경 처리
 * 입주자/비용의 입력 필드가 변경될 때 호출됩니다.
 */
function updateField(type, id, field, value) {
    id = parseInt(id);
    var list = type === 'resident' ? state.residents : state.expenses;
    var item = list.find(function(i) { return i.id === id; });
    if (!item) return;

    // 금액 필드는 숫자로 변환
    if (field === 'amount') {
        item[field] = parseFloat(value) || 0;
    } else {
        item[field] = value;
    }
    saveToStorage();
}

/**
 * 입력 유효성 검증
 * 계산 전에 모든 필수 입력이 올바른지 확인합니다.
 *
 * @returns {string|null} 에러 메시지 또는 null (유효한 경우)
 */
function validate() {
    // 입주자가 최소 1명 있는지
    if (state.residents.length === 0) {
        return '입주자를 최소 1명 이상 추가해주세요.';
    }

    // 비용 항목이 최소 1개 있는지
    if (state.expenses.length === 0) {
        return '공용비용을 최소 1개 이상 추가해주세요.';
    }

    // 입주자 필드 검증
    for (var i = 0; i < state.residents.length; i++) {
        var r = state.residents[i];
        if (!r.name.trim()) {
            return (i + 1) + '번째 입주자의 이름을 입력해주세요.';
        }
        if (!r.moveInDate) {
            return r.name + '님의 입실일을 입력해주세요.';
        }
        // 퇴실일이 입실일보다 빠른지 확인
        if (r.moveOutDate && r.moveOutDate < r.moveInDate) {
            return r.name + '님의 퇴실일이 입실일보다 빠릅니다.';
        }
    }

    // 비용 필드 검증
    for (var j = 0; j < state.expenses.length; j++) {
        var e = state.expenses[j];
        if (!e.name.trim()) {
            return (j + 1) + '번째 비용 항목의 이름을 입력해주세요.';
        }
        if (!e.amount || e.amount <= 0) {
            return e.name + '의 금액을 입력해주세요.';
        }
        if (!e.startDate || !e.endDate) {
            return e.name + '의 청구 기간을 입력해주세요.';
        }
        if (e.endDate < e.startDate) {
            return e.name + '의 종료일이 시작일보다 빠릅니다.';
        }
    }

    return null; // 유효함
}

/**
 * 정산하기 버튼 클릭 처리
 */
function onCalculate() {
    // 기존 에러 메시지 제거
    var existingError = document.querySelector('.error-message');
    if (existingError) existingError.remove();

    // 유효성 검증
    var error = validate();
    if (error) {
        // 에러 메시지 표시
        var errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = error;
        var calcBtn = document.getElementById('calculate-btn');
        calcBtn.parentNode.insertBefore(errorDiv, calcBtn);
        return;
    }

    // 계산 실행 및 결과 표시
    var result = calculate();
    renderResults(result);

    // 마지막 계산 결과를 저장 (복사 기능에서 사용)
    state.lastResult = result;

    // 정산 이력에 자동 저장
    saveToHistory(result);
    saveToStorage();
}

/**
 * 결과를 텍스트로 복사합니다.
 * 카카오톡 등 메신저로 보내기 좋은 형식으로 포맷합니다.
 */
function copyResults() {
    if (!state.lastResult) return;

    var result = state.lastResult;
    var text = '';

    // ─── 복사용 텍스트 포맷 ───
    text += '📊 쉐어하우스 공용비용 정산\n';
    text += '━━━━━━━━━━━━━━━\n';
    text += '💰 총 비용: ' + formatCurrency(result.totalExpense) + '\n\n';

    // 인별 요약
    var residentIds = Object.keys(result.results);
    residentIds.forEach(function(id) {
        var r = result.results[id];
        text += '👤 ' + r.name + ': ' + formatCurrency(roundTo10(r.total)) + '\n';
    });

    // 상세 내역
    text += '\n📋 상세내역\n';
    result.details.forEach(function(detail) {
        text += '• ' + detail.name + ' (' + formatDateShort(detail.startDate) + '~' + formatDateShort(detail.endDate) + ', ' + formatCurrency(detail.amount) + ')\n';
        state.residents.forEach(function(r) {
            var share = detail.shares[r.id];
            if (share && share.amount > 0) {
                text += '  - ' + r.name + ': ' + formatCurrency(roundTo10(share.amount)) + ' (' + share.days + '일)\n';
            }
        });
        if (detail.vacantDays > 0) {
            text += '  - 공실 ' + detail.vacantDays + '일 (거주자 분담)\n';
        }
    });

    // 송금 안내
    if (result.transfers && result.transfers.length > 0) {
        text += '\n💸 송금 안내\n';
        result.transfers.forEach(function(t) {
            text += '  ' + t.from + ' → ' + t.to + ': ' + formatCurrency(t.amount) + '\n';
        });
    }

    text += '\n※ 10원 단위 반올림 적용';

    // 클립보드에 복사
    navigator.clipboard.writeText(text).then(function() {
        showToast('결과가 복사되었습니다! 메신저에 붙여넣기하세요.');
    }).catch(function() {
        // 클립보드 API가 안 되는 경우 대안
        fallbackCopy(text);
    });
}

/**
 * 클립보드 API를 사용할 수 없을 때의 대안 복사 방법
 */
function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast('결과가 복사되었습니다!');
    } catch (e) {
        showToast('복사에 실패했습니다. 직접 선택하여 복사해주세요.');
    }
    document.body.removeChild(textarea);
}

/**
 * 토스트 알림을 표시합니다.
 * 잠깐 나타났다 사라지는 하단 알림입니다.
 */
function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('toast--visible');
    setTimeout(function() {
        toast.classList.remove('toast--visible');
    }, 2500);
}

/**
 * 예시 데이터를 로드합니다.
 * 처음 사용하는 사람이 기능을 이해할 수 있도록 도와줍니다.
 */
function loadSampleData() {
    if (state.residents.some(function(r) { return r.name.trim(); }) ||
        state.expenses.some(function(e) { return e.name.trim(); })) {
        if (!confirm('현재 입력된 데이터가 예시 데이터로 대체됩니다. 계속하시겠습니까?')) {
            return;
        }
    }

    state.residents = [
        { id: generateId(), name: '김민수', moveInDate: '2025-12-01', moveOutDate: '' },
        { id: generateId(), name: '이영희', moveInDate: '2026-01-10', moveOutDate: '' },
        { id: generateId(), name: '박지훈', moveInDate: '2025-12-01', moveOutDate: '2026-01-31' }
    ];
    state.expenses = [
        { id: generateId(), name: '전기세', amount: 85000, startDate: '2026-01-01', endDate: '2026-01-31' },
        { id: generateId(), name: '가스비', amount: 42000, startDate: '2026-01-01', endDate: '2026-01-31' },
        { id: generateId(), name: '인터넷', amount: 33000, startDate: '2026-01-01', endDate: '2026-01-31' }
    ];

    renderResidents();
    renderExpenses();
    saveToStorage();
    document.getElementById('results-section').style.display = 'none';
    showToast('예시 데이터가 로드되었습니다. 정산하기를 눌러보세요!');
}

/**
 * 다크모드 토글
 */
function toggleDarkMode() {
    var html = document.documentElement;
    var isDark = html.getAttribute('data-theme') === 'dark';
    var newTheme = isDark ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    document.getElementById('dark-mode-icon').innerHTML = isDark ? '&#9790;' : '&#9728;';
    try {
        localStorage.setItem('sharecalc_theme', newTheme);
    } catch (e) {}
}

/**
 * 저장된 테마 적용
 */
function loadTheme() {
    try {
        var theme = localStorage.getItem('sharecalc_theme');
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('dark-mode-icon').innerHTML = '&#9728;';
        } else if (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('dark-mode-icon').innerHTML = '&#9728;';
        }
    } catch (e) {}
}

/**
 * 데이터를 JSON 파일로 내보냅니다.
 */
function exportData() {
    var data = {
        version: 1,
        exportDate: new Date().toISOString(),
        residents: state.residents,
        expenses: state.expenses
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'sharecalc_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('데이터가 내보내기되었습니다.');
}

/**
 * JSON 파일에서 데이터를 가져옵니다.
 */
function importData(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = JSON.parse(e.target.result);
            if (!data.residents || !data.expenses) {
                showToast('올바른 ShareCalc 데이터 파일이 아닙니다.');
                return;
            }
            state.residents = data.residents;
            state.expenses = data.expenses;
            state.nextId = Math.max.apply(null,
                state.residents.map(function(r) { return r.id; })
                    .concat(state.expenses.map(function(e) { return e.id; }))
                    .concat([0])
            ) + 1;
            renderResidents();
            renderExpenses();
            saveToStorage();
            document.getElementById('results-section').style.display = 'none';
            showToast('데이터를 성공적으로 가져왔습니다.');
        } catch (err) {
            showToast('파일을 읽는 중 오류가 발생했습니다.');
        }
    };
    reader.readAsText(file);
}

/**
 * 데이터 초기화
 */
function resetData() {
    if (!confirm('모든 데이터를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
        return;
    }
    var savedHistory = state.history || [];
    state = { residents: [], expenses: [], history: savedHistory, nextId: 1 };
    renderResidents();
    renderExpenses();
    document.getElementById('results-section').style.display = 'none';
    saveToStorage();
    showToast('데이터가 초기화되었습니다.');
}

// ========================================
// 6. 프로필 관리 (회원가입/로그인)
// ========================================

var PROFILES_KEY = 'sharecalc_profiles';

/**
 * 저장된 모든 프로필 목록을 가져옵니다.
 */
function getProfiles() {
    try {
        var raw = localStorage.getItem(PROFILES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

/**
 * 프로필 목록을 저장합니다.
 */
function saveProfiles(profiles) {
    try {
        localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    } catch (e) {}
}

/**
 * 간단한 해시 함수 (비밀번호 저장용)
 * 실제 보안 목적이 아닌 로컬 프로필 구분용입니다.
 */
function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        var ch = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return hash.toString(36);
}

/**
 * 회원가입
 */
function signUp(name, password) {
    var profiles = getProfiles();
    var exists = profiles.some(function(p) { return p.name === name; });
    if (exists) return { ok: false, msg: '이미 존재하는 이름입니다.' };
    if (!name.trim()) return { ok: false, msg: '이름을 입력해주세요.' };
    if (!password || password.length < 4) return { ok: false, msg: '비밀번호를 4자 이상 입력해주세요.' };

    var profile = {
        id: Date.now().toString(36),
        name: name.trim(),
        hash: simpleHash(password),
        createdAt: new Date().toISOString()
    };
    profiles.push(profile);
    saveProfiles(profiles);
    return { ok: true, profile: profile };
}

/**
 * 로그인
 */
function logIn(name, password) {
    var profiles = getProfiles();
    var profile = profiles.find(function(p) { return p.name === name; });
    if (!profile) return { ok: false, msg: '존재하지 않는 계정입니다.' };
    if (profile.hash !== simpleHash(password)) return { ok: false, msg: '비밀번호가 일치하지 않습니다.' };
    return { ok: true, profile: profile };
}

/**
 * 프로필 로그인 후 데이터 로드
 */
function activateProfile(profile) {
    currentProfile = profile;
    try {
        localStorage.setItem('sharecalc_current', profile.id);
    } catch (e) {}
    loadFromStorage();
    showApp();
    initApp();
}

/**
 * 로그아웃
 */
function logOut() {
    currentProfile = null;
    try {
        localStorage.removeItem('sharecalc_current');
    } catch (e) {}
    state = { residents: [], expenses: [], history: [], nextId: 1 };
    showAuthScreen();
}

/**
 * 앱 화면 표시 (로그인 후)
 */
function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = '';
    var userNameEl = document.getElementById('current-user-name');
    if (userNameEl && currentProfile) {
        userNameEl.textContent = currentProfile.name;
    }
}

/**
 * 인증 화면 표시 (로그인 전)
 */
function showAuthScreen() {
    document.getElementById('auth-screen').style.display = '';
    document.getElementById('app-screen').style.display = 'none';
    // 폼 초기화
    var inputs = document.querySelectorAll('#auth-screen input');
    inputs.forEach(function(input) { input.value = ''; });
    var errEl = document.getElementById('auth-error');
    if (errEl) errEl.textContent = '';
}

/**
 * 로그인 폼 / 회원가입 폼 전환
 */
function toggleAuthMode() {
    var loginForm = document.getElementById('login-form');
    var signupForm = document.getElementById('signup-form');
    if (loginForm.style.display === 'none') {
        loginForm.style.display = '';
        signupForm.style.display = 'none';
    } else {
        loginForm.style.display = 'none';
        signupForm.style.display = '';
    }
    var errEl = document.getElementById('auth-error');
    if (errEl) errEl.textContent = '';
}

// ========================================
// 7. 정산 이력 관리
// ========================================

/**
 * 현재 정산 결과를 이력에 저장합니다.
 */
function saveToHistory(calcResult) {
    var entry = {
        id: Date.now().toString(36),
        date: new Date().toISOString(),
        totalExpense: calcResult.totalExpense,
        residents: state.residents.map(function(r) {
            return { name: r.name, moveInDate: r.moveInDate, moveOutDate: r.moveOutDate };
        }),
        expenses: state.expenses.map(function(e) {
            return { name: e.name, amount: e.amount, startDate: e.startDate, endDate: e.endDate };
        }),
        personResults: Object.keys(calcResult.results).map(function(id) {
            var r = calcResult.results[id];
            return { name: r.name, total: roundTo10(r.total) };
        })
    };
    state.history.unshift(entry); // 최신이 먼저
    if (state.history.length > 50) state.history.pop(); // 최대 50개
    saveToStorage();
}

/**
 * 이력 화면을 렌더링합니다.
 */
function renderHistory() {
    var container = document.getElementById('history-content');
    if (!container) return;

    if (!state.history || state.history.length === 0) {
        container.innerHTML = '<p class="history-empty">정산 이력이 없습니다. 정산을 실행하면 자동으로 저장됩니다.</p>';
        return;
    }

    var html = '';
    state.history.forEach(function(entry, index) {
        var dateObj = new Date(entry.date);
        var dateStr = dateObj.getFullYear() + '.' +
            String(dateObj.getMonth() + 1).padStart(2, '0') + '.' +
            String(dateObj.getDate()).padStart(2, '0');

        html += '<div class="history-item">';
        html += '<div class="history-item__header">';
        html += '<span class="history-item__date">' + dateStr + '</span>';
        html += '<span class="history-item__total">' + formatCurrency(entry.totalExpense) + '</span>';
        html += '<button type="button" class="btn-delete btn-delete--small" data-history-index="' + index + '" title="이력 삭제" aria-label="이력 삭제">&times;</button>';
        html += '</div>';
        html += '<div class="history-item__people">';
        entry.personResults.forEach(function(p) {
            html += '<span class="history-chip">' + escapeHtml(p.name) + ' ' + formatCurrency(p.total) + '</span>';
        });
        html += '</div>';
        html += '<button type="button" class="btn-link history-load-btn" data-history-index="' + index + '">이 데이터 불러오기</button>';
        html += '</div>';
    });

    container.innerHTML = html;
}

/**
 * 이력에서 데이터를 불러옵니다.
 */
function loadFromHistory(index) {
    var entry = state.history[index];
    if (!entry) return;

    if (state.residents.some(function(r) { return r.name.trim(); })) {
        if (!confirm('현재 데이터가 이력의 데이터로 대체됩니다. 계속하시겠습니까?')) return;
    }

    state.residents = entry.residents.map(function(r) {
        return { id: generateId(), name: r.name, moveInDate: r.moveInDate, moveOutDate: r.moveOutDate || '' };
    });
    state.expenses = entry.expenses.map(function(e) {
        return { id: generateId(), name: e.name, amount: e.amount, startDate: e.startDate, endDate: e.endDate };
    });

    renderResidents();
    renderExpenses();
    saveToStorage();
    document.getElementById('results-section').style.display = 'none';

    // 이력 탭에서 정산기 탭으로 전환
    switchTab('calculator');
    showToast('이력 데이터를 불러왔습니다.');
}

/**
 * 이력 삭제
 */
function deleteHistory(index) {
    state.history.splice(index, 1);
    saveToStorage();
    renderHistory();
    showToast('이력이 삭제되었습니다.');
}

/**
 * 탭 전환 (정산기 / 이력)
 */
function switchTab(tabName) {
    var calcTab = document.getElementById('tab-calculator');
    var histTab = document.getElementById('tab-history');
    var calcContent = document.getElementById('calculator-content');
    var histContent = document.getElementById('history-section');

    if (tabName === 'calculator') {
        calcTab.classList.add('tab--active');
        histTab.classList.remove('tab--active');
        calcContent.style.display = '';
        histContent.style.display = 'none';
    } else {
        calcTab.classList.remove('tab--active');
        histTab.classList.add('tab--active');
        calcContent.style.display = 'none';
        histContent.style.display = '';
        renderHistory();
    }
}

// ========================================
// 8. 데이터 저장/불러오기 (localStorage)
// ========================================

/**
 * 현재 상태를 브라우저에 저장합니다.
 * 프로필별로 별도의 키를 사용합니다.
 */
function saveToStorage() {
    if (!currentProfile) return;
    try {
        var data = {
            residents: state.residents,
            expenses: state.expenses,
            history: state.history,
            nextId: state.nextId
        };
        localStorage.setItem('sharecalc_data_' + currentProfile.id, JSON.stringify(data));
    } catch (e) {}
}

/**
 * 브라우저에 저장된 데이터를 불러옵니다.
 */
function loadFromStorage() {
    if (!currentProfile) return;
    try {
        var raw = localStorage.getItem('sharecalc_data_' + currentProfile.id);
        if (raw) {
            var data = JSON.parse(raw);
            state.residents = data.residents || [];
            state.expenses = data.expenses || [];
            state.history = data.history || [];
            state.nextId = data.nextId || 1;
        } else {
            state = { residents: [], expenses: [], history: [], nextId: 1 };
        }
    } catch (e) {
        state = { residents: [], expenses: [], history: [], nextId: 1 };
    }
}

// ========================================
// 7. 초기화 (앱 시작)
// ========================================

/**
 * 이벤트 위임 (Event Delegation)
 * 왜 이 방식을 사용하는지:
 * 입주자/비용 항목이 동적으로 추가/삭제되기 때문에,
 * 각 요소에 개별적으로 이벤트를 붙이면 관리가 어렵습니다.
 * 대신 부모 요소에 한 번만 이벤트를 등록하고,
 * 실제 클릭/변경된 요소를 찾아서 처리합니다.
 */
function initEvents() {
    // ─── 인증 관련 이벤트 ───
    document.getElementById('login-submit').addEventListener('click', function() {
        var name = document.getElementById('login-name').value;
        var pass = document.getElementById('login-pass').value;
        var result = logIn(name, pass);
        if (result.ok) {
            activateProfile(result.profile);
        } else {
            document.getElementById('auth-error').textContent = result.msg;
        }
    });

    document.getElementById('signup-submit').addEventListener('click', function() {
        var name = document.getElementById('signup-name').value;
        var pass = document.getElementById('signup-pass').value;
        var result = signUp(name, pass);
        if (result.ok) {
            activateProfile(result.profile);
            showToast('회원가입이 완료되었습니다!');
        } else {
            document.getElementById('auth-error').textContent = result.msg;
        }
    });

    document.getElementById('toggle-auth-mode').addEventListener('click', toggleAuthMode);
    document.getElementById('toggle-auth-mode-2').addEventListener('click', toggleAuthMode);
    document.getElementById('logout-btn').addEventListener('click', logOut);

    // Enter 키로 로그인/회원가입
    document.getElementById('login-pass').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') document.getElementById('login-submit').click();
    });
    document.getElementById('signup-pass').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') document.getElementById('signup-submit').click();
    });

    // ─── 탭 전환 ───
    document.getElementById('tab-calculator').addEventListener('click', function() { switchTab('calculator'); });
    document.getElementById('tab-history').addEventListener('click', function() { switchTab('history'); });

    // 입주자 추가 버튼
    document.getElementById('add-resident-btn').addEventListener('click', addResident);

    // 비용 추가 버튼
    document.getElementById('add-expense-btn').addEventListener('click', addExpense);

    // 정산하기 버튼
    document.getElementById('calculate-btn').addEventListener('click', onCalculate);

    // 결과 복사 버튼
    document.getElementById('copy-btn').addEventListener('click', copyResults);

    // 데이터 초기화 버튼
    document.getElementById('reset-btn').addEventListener('click', resetData);

    // 예시 데이터 버튼
    document.getElementById('sample-data-btn').addEventListener('click', loadSampleData);

    // 다크모드 토글
    document.getElementById('dark-mode-btn').addEventListener('click', toggleDarkMode);

    // 데이터 내보내기
    document.getElementById('export-btn').addEventListener('click', exportData);

    // 데이터 가져오기
    document.getElementById('import-input').addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) {
            importData(e.target.files[0]);
            e.target.value = '';
        }
    });

    // ─── 이벤트 위임: 삭제 버튼 & 이력 버튼 ───
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('.btn-delete');
        if (btn) {
            if (btn.dataset.historyIndex !== undefined) {
                deleteHistory(parseInt(btn.dataset.historyIndex));
                return;
            }
            deleteItem(btn.dataset.type, btn.dataset.id);
            return;
        }

        var histBtn = e.target.closest('.history-load-btn');
        if (histBtn && histBtn.dataset.historyIndex !== undefined) {
            loadFromHistory(parseInt(histBtn.dataset.historyIndex));
        }
    });

    // ─── 이벤트 위임: 입력 필드 변경 ───
    document.addEventListener('input', function(e) {
        var el = e.target;
        if (el.dataset && el.dataset.type && el.dataset.field && el.dataset.id) {
            updateField(el.dataset.type, el.dataset.id, el.dataset.field, el.value);
        }
    });

    // select 필드도 change 이벤트로 처리
    document.addEventListener('change', function(e) {
        var el = e.target;
        if (el.tagName === 'SELECT' && el.dataset && el.dataset.type && el.dataset.field) {
            updateField(el.dataset.type, el.dataset.id, el.dataset.field, el.value);
        }
    });
}

/**
 * 앱 시작점
 */
function init() {
    // 테마 로드
    loadTheme();

    // 이벤트 등록 (인증 포함)
    initEvents();

    // 자동 로그인 시도: 이전에 로그인한 프로필이 있으면 복원
    try {
        var savedProfileId = localStorage.getItem('sharecalc_current');
        if (savedProfileId) {
            var profiles = getProfiles();
            var profile = profiles.find(function(p) { return p.id === savedProfileId; });
            if (profile) {
                activateProfile(profile);
                return;
            }
        }
    } catch (e) {}

    // 로그인 상태가 아니면 인증 화면 표시
    showAuthScreen();
}

/**
 * 로그인 후 앱 초기화
 */
function initApp() {
    // 데이터가 없으면 기본 빈 항목 추가
    if (state.residents.length === 0) {
        state.residents.push({ id: generateId(), name: '', moveInDate: '', moveOutDate: '' });
    }
    if (state.expenses.length === 0) {
        state.expenses.push({ id: generateId(), name: '', amount: 0, startDate: '', endDate: '' });
    }

    renderResidents();
    renderExpenses();
}

// DOM이 준비되면 앱 시작
document.addEventListener('DOMContentLoaded', init);
