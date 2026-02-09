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
// 앱의 모든 데이터는 이 state 객체에 저장됩니다.
// residents: 입주자 목록 (이름, 입실일, 퇴실일)
// expenses: 공용비용 목록 (항목명, 금액, 청구기간)
let state = {
    residents: [],
    expenses: [],
    nextId: 1  // 고유 ID 생성용 카운터
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
 * @returns {object} {
 *   results: { [id]: { name, total, totalDays, expenses: [...] } },
 *   details: [ { name, amount, startDate, endDate, shares, vacantDays, vacantCost } ],
 *   totalExpense: number,
 *   totalVacantCost: number
 * }
 */
function calculate() {
    const results = {};
    const details = [];
    let totalExpense = 0;
    let totalVacantCost = 0;

    // 각 입주자의 총 부담액을 0으로 초기화
    state.residents.forEach(function(r) {
        results[r.id] = {
            name: r.name,
            total: 0,
            totalDays: 0,    // 총 거주일수 (비용별 합산)
            expenses: []     // 비용별 상세 내역
        };
    });

    // ─── 각 비용 항목별로 일할 계산 수행 ───
    state.expenses.forEach(function(expense) {
        totalExpense += expense.amount;

        // 이 비용 항목의 상세 결과를 저장할 객체
        var expenseDetail = {
            name: expense.name,
            amount: expense.amount,
            startDate: expense.startDate,
            endDate: expense.endDate,
            shares: {},       // 입주자별 분담 정보
            vacantDays: 0,    // 공실 일수 (아무도 없는 날)
            vacantCost: 0     // 공실 비용 (운영자 부담분)
        };

        // ★ 핵심: 청구 기간의 총 일수와 1일당 비용 계산
        var totalDays = getDayCount(expense.startDate, expense.endDate);
        var dailyCost = expense.amount / totalDays;

        // 각 입주자의 분담 정보 초기화
        state.residents.forEach(function(r) {
            expenseDetail.shares[r.id] = { days: 0, amount: 0 };
        });

        // ★ 핵심: 매일을 순회하며 그날의 거주자를 찾아 비용 분할
        forEachDay(expense.startDate, expense.endDate, function(dateStr) {

            // 이 날짜에 거주 중인 입주자 필터링
            // 조건: 입실일 <= 해당일 <= 퇴실일 (퇴실일 없으면 아직 거주 중)
            var presentResidents = state.residents.filter(function(r) {
                var afterMoveIn = dateStr >= r.moveInDate;
                var beforeMoveOut = !r.moveOutDate || dateStr <= r.moveOutDate;
                return afterMoveIn && beforeMoveOut;
            });

            if (presentResidents.length === 0) {
                // ⚠️ 아무도 없는 날 = 공실
                // 이 비용은 운영자가 부담해야 합니다
                expenseDetail.vacantDays++;
                expenseDetail.vacantCost += dailyCost;
            } else {
                // ★ 그날의 비용을 거주자 수로 균등 분할
                var perPerson = dailyCost / presentResidents.length;

                presentResidents.forEach(function(r) {
                    expenseDetail.shares[r.id].days++;
                    expenseDetail.shares[r.id].amount += perPerson;
                    results[r.id].total += perPerson;
                    results[r.id].totalDays++;
                });
            }
        });

        // 공실 비용 합산
        totalVacantCost += expenseDetail.vacantCost;

        // 각 입주자의 이 비용에 대한 상세 내역 저장
        state.residents.forEach(function(r) {
            if (expenseDetail.shares[r.id].amount > 0) {
                results[r.id].expenses.push({
                    name: expense.name,
                    days: expenseDetail.shares[r.id].days,
                    amount: expenseDetail.shares[r.id].amount
                });
            }
        });

        details.push(expenseDetail);
    });

    return {
        results: results,
        details: details,
        totalExpense: totalExpense,
        totalVacantCost: totalVacantCost
    };
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
            '<button type="button" class="btn-delete" data-type="resident" data-id="' + resident.id + '" title="삭제">&times;</button>' +
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
            '<button type="button" class="btn-delete" data-type="expense" data-id="' + expense.id + '" title="삭제">&times;</button>' +
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

    // ─── 공실 비용 경고 (공실이 있는 경우에만 표시) ───
    if (calcResult.totalVacantCost > 0) {
        html += '<div class="vacant-warning">';
        html += '<span>⚠️</span>';
        html += '<span>공실 기간 비용 (운영자 부담): <strong>' + formatCurrency(roundTo10(calcResult.totalVacantCost)) + '</strong></span>';
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

        // 공실 표시
        if (detail.vacantDays > 0) {
            html += '<div class="detail-row">';
            html += '<span class="detail-row__name" style="color:var(--warning)">공실 (운영자)</span>';
            html += '<div class="detail-row__info">';
            html += '<span class="detail-row__days">' + detail.vacantDays + '일</span>';
            html += '<span class="detail-row__amount" style="color:var(--warning)">' + formatCurrency(roundTo10(detail.vacantCost)) + '</span>';
            html += '</div>';
            html += '</div>';
        }

        html += '</div>'; // breakdown
        html += '</div>'; // detail-expense
    });

    html += '</div>'; // result-detail

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

    // 공실 비용
    if (result.totalVacantCost > 0) {
        text += '\n⚠️ 공실 비용 (운영자): ' + formatCurrency(roundTo10(result.totalVacantCost)) + '\n';
    }

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
            text += '  - 공실: ' + formatCurrency(roundTo10(detail.vacantCost)) + ' (' + detail.vacantDays + '일)\n';
        }
    });

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
 * 데이터 초기화
 */
function resetData() {
    if (!confirm('모든 데이터를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
        return;
    }
    state = { residents: [], expenses: [], nextId: 1 };
    renderResidents();
    renderExpenses();
    document.getElementById('results-section').style.display = 'none';
    saveToStorage();
    showToast('데이터가 초기화되었습니다.');
}

// ========================================
// 6. 데이터 저장/불러오기 (localStorage)
// ========================================
// 브라우저를 닫았다 열어도 데이터가 유지됩니다.
// localStorage는 브라우저 내부 저장소로, 서버가 필요없습니다.

var STORAGE_KEY = 'sharecalc_data';

/**
 * 현재 상태를 브라우저에 저장합니다.
 */
function saveToStorage() {
    try {
        var data = {
            residents: state.residents,
            expenses: state.expenses,
            nextId: state.nextId
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        // localStorage가 꽉 찼거나 사용 불가한 경우 무시
    }
}

/**
 * 브라우저에 저장된 데이터를 불러옵니다.
 */
function loadFromStorage() {
    try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            var data = JSON.parse(raw);
            state.residents = data.residents || [];
            state.expenses = data.expenses || [];
            state.nextId = data.nextId || 1;
        }
    } catch (e) {
        // 파싱 오류 시 기본 상태 유지
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

    // ─── 이벤트 위임: 삭제 버튼 ───
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('.btn-delete');
        if (btn) {
            deleteItem(btn.dataset.type, btn.dataset.id);
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
    // 저장된 데이터 불러오기
    loadFromStorage();

    // 데이터가 없으면 빈 입주자 1명 + 빈 비용 1개를 기본 추가
    // (사용자가 바로 입력을 시작할 수 있도록)
    if (state.residents.length === 0) {
        state.residents.push({ id: generateId(), name: '', moveInDate: '', moveOutDate: '' });
    }
    if (state.expenses.length === 0) {
        state.expenses.push({ id: generateId(), name: '', amount: 0, startDate: '', endDate: '' });
    }

    // 화면 렌더링
    renderResidents();
    renderExpenses();

    // 이벤트 등록
    initEvents();
}

// DOM이 준비되면 앱 시작
document.addEventListener('DOMContentLoaded', init);
