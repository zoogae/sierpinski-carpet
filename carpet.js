"use strict";

var canvas;
var gl;
var program;

// ----- 기하 데이터 -----
var points = [];               // 정점 위치 (vec2)
var locals = [];               // 사각형 내부 좌표 (vec2, 0 ~ 1)
var levels = [];               // 정점으로 분할한 단계 (float)
var depths = [];               // 목표 분할 횟수 (float)
var squares = [];              // 현재 그려지는 사각형 목록 (잎 노드)

var NumTimes = 3;              // 전체 분할 횟수
var MaxTimes = 8;              // 최대 분할 횟수
var MaxGeometryLevel    = 5;   // 정점으로 나누는 최대 단계 (8^5 = 32,768개)
                               // 그 이상은 단편 shader에서 가운데를 제거

var vBuffer, localBuffer, levelBuffer, depthBuffer;

// ----- 색상 -----
var palettes = [
    // 무지개
    ["#3a0ca3", "#4361ee", "#4cc9f0", "#2a9d8f", "#8ac926",
     "#ffca3a", "#ff924c", "#ff595e", "#c9184a"],
    // 바다
    ["#012a4a", "#013a63", "#01497c", "#014f86", "#2a6f97",
     "#2c7da0", "#468faf", "#61a5c2", "#89c2d9"],
    // 노을
    ["#355070", "#515575", "#6d597a", "#915f78", "#b56576",
     "#d06f6f", "#e56b6f", "#eaac8b", "#f4a261"]
];
var paletteIndex = 0;
var bgColor    = vec4(0.992, 0.988, 0.973, 1.0);
var depthShift = 0.0;          // 색상 전환 보간 값 (0이면 전환 완료)
var filterMode = 0;            // 0: RGB, 1: CMY, 2: NTSC 명암도
var hoverBox   = vec4(9.0, 9.0, 9.0, 9.0);   // 강조 영역 없음

var paletteLoc, depthShiftLoc, filterModeLoc, hoverBoxLoc;

// ----- 애니메이션 -----
var growing       = false;     // 성장 애니메이션 중인지
var delay         = 600;       // 성장 단계 사이 간격 (ms)
var colorAnimating = false;    // 색상 전환 애니메이션 중인지


window.onload = function init()
{
    canvas = document.getElementById("gl-canvas");

    // 고해상도 화면에서도 선명하게: 표시 크기 x 화소 비율만큼 캔버스 해상도 설정
    var ratio = window.devicePixelRatio || 1;
    canvas.width  = canvas.clientWidth  * ratio;
    canvas.height = canvas.clientHeight * ratio;

    gl = WebGLUtils.setupWebGL(canvas);
    if (!gl) { alert("WebGL isn't available"); return; }

    gl.viewport(0, 0, canvas.width, canvas.height);

    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    vBuffer     = createAttribute("vPosition", 2);
    localBuffer = createAttribute("vLocal",    2);
    levelBuffer = createAttribute("vLevel",    1);
    depthBuffer = createAttribute("vDepth",    1);

    paletteLoc    = gl.getUniformLocation(program, "palette");
    depthShiftLoc = gl.getUniformLocation(program, "depthShift");
    filterModeLoc = gl.getUniformLocation(program, "filterMode");
    hoverBoxLoc   = gl.getUniformLocation(program, "hoverBox");

    setupEventListeners();
    updatePaletteView();
    buildCarpet();
};

// 버퍼를 만들고 shader의 attribute 변수와 연결
function createAttribute(name, size)
{
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    var location = gl.getAttribLocation(program, name);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(location);
    return buffer;
}


// =========================================================
// 1. 기하 데이터 생성
// =========================================================

// 사각형 노드: 왼쪽 아래 (x, y), 한 변 size,
// level: 정점으로 분할한 단계, depth: 목표 분할 횟수, parent: 부모
function makeSquare(x, y, size, level, parent)
{
    return { x: x, y: y, size: size, level: level, depth: level, parent: parent };
}

// 3 x 3으로 나누고 가운데를 버린 8개를 count번 재귀 분할
function divideSquare(sq, count)
{
    if (count === 0) {
        squares.push(sq);
        return;
    }
    var s = sq.size / 3;
    for (var row = 0; row < 3; row++) {
        for (var col = 0; col < 3; col++) {
            if (row === 1 && col === 1) continue;   // 가운데 제거
            var child = makeSquare(sq.x + col * s, sq.y + row * s, s, sq.level + 1, sq);
            divideSquare(child, count - 1);
        }
    }
}

// 사각형 하나 = 삼각형 2개 = 정점 6개
function square(sq)
{
    var a = vec2(sq.x,           sq.y);
    var b = vec2(sq.x + sq.size, sq.y);
    var c = vec2(sq.x + sq.size, sq.y + sq.size);
    var d = vec2(sq.x,           sq.y + sq.size);
    points.push(a, b, c, a, c, d);
    locals.push(vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 0), vec2(1, 1), vec2(0, 1));
    for (var i = 0; i < 6; i++) {
        levels.push(sq.level);
        depths.push(sq.depth);
    }
}

// 전체를 NumTimes번 균일하게 분할
// 정점 분할은 MaxGeometryLevel까지만 하고 나머지는 depth로 shader에 전달
function buildCarpet()
{
    squares = [];
    var root = makeSquare(-0.95, -0.95, 1.9, 0, null);
    divideSquare(root, Math.min(NumTimes, MaxGeometryLevel));
    for (var i = 0; i < squares.length; i++) squares[i].depth = NumTimes;
    uploadData();
}


// =========================================================
// 2. GPU로 데이터 전송 및 렌더링
// =========================================================
function uploadData()
{
    points = []; locals = []; levels = []; depths = [];
    for (var i = 0; i < squares.length; i++) square(squares[i]);

    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, localBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(locals), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, levelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(levels), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, depthBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(depths), gl.STATIC_DRAW);

    updateInfo();
    render();
}

function render()
{
    gl.clearColor(bgColor[0], bgColor[1], bgColor[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform3fv(paletteLoc,   paletteToFloats(palettes[paletteIndex]));
    gl.uniform1f(depthShiftLoc, depthShift);
    gl.uniform1i(filterModeLoc, filterMode);
    gl.uniform4fv(hoverBoxLoc,  hoverBox);

    gl.drawArrays(gl.TRIANGLES, 0, points.length);
}


// =========================================================
// 3. 분할 횟수 제어
// =========================================================

// (1) 전체 분할 횟수 변경 + 색상 전환 시작
function setDepth(n)
{
    n = Math.max(0, Math.min(MaxTimes, n));
    if (n === NumTimes) return;

    depthShift += NumTimes - n;   // 이전 횟수의 색에서 출발
    NumTimes = n;

    document.getElementById("DepthSlider").value = n;
    document.getElementById("DepthValue").textContent = n;
    updatePaletteView();
    buildCarpet();
    startColorTransition();
}

// (2) 마우스 위치 → 클립 좌표
function getClipPosition(event)
{
    var rect = canvas.getBoundingClientRect();
    return vec2(-1 + 2 * (event.clientX - rect.left) / rect.width,
                -1 + 2 * (rect.height - (event.clientY - rect.top)) / rect.height);
}

// 경계 상자로 고르기: 점 t를 포함하는 사각형의 인덱스, 없으면 -1
function pickSquare(t)
{
    for (var i = 0; i < squares.length; i++) {
        var sq = squares[i];
        if (t[0] >= sq.x && t[0] <= sq.x + sq.size &&
            t[1] >= sq.y && t[1] <= sq.y + sq.size) return i;
    }
    return -1;
}

// 클릭한 사각형만 한 단계 더 분할
function subdivideAt(t)
{
    var index = pickSquare(t);
    if (index < 0) return;
    var sq = squares[index];
    if (sq.depth >= MaxTimes) return;

    if (sq.level < MaxGeometryLevel) {
        squares.splice(index, 1);        // 정점으로 분할
        divideSquare(sq, 1);
    } else {
        sq.depth++;                      // shader에서 한 단계 더 제거
    }
    uploadData();
}

// sq가 ancestor의 자손인지 검사
function isDescendant(sq, ancestor)
{
    for (var p = sq.parent; p !== null; p = p.parent) {
        if (p === ancestor) return true;
    }
    return false;
}

// 클릭한 사각형을 한 단계 합치기
function mergeAt(t)
{
    var index = pickSquare(t);
    if (index < 0) return;
    var sq = squares[index];

    if (sq.depth > sq.level) {
        sq.depth--;                      // shader 분할 단계를 하나 줄임
    } else {
        var parent = sq.parent;
        if (parent === null) return;
        squares = squares.filter(function (s) { return !isDescendant(s, parent); });
        parent.depth = parent.level;
        squares.push(parent);
    }
    uploadData();
}

// (3) 성장 애니메이션: 0단계부터 목표 단계까지 차례로 분할
function startGrowing()
{
    if (growing) return;
    growing = true;
    document.getElementById("GrowButton").disabled = true;

    var target = NumTimes > 0 ? NumTimes : MaxTimes;
    setDepth(0);

    function grow() {
        if (NumTimes >= target) {
            growing = false;
            document.getElementById("GrowButton").disabled = false;
            return;
        }
        setTimeout(function () {
            setDepth(NumTimes + 1);
            grow();
        }, delay);
    }
    grow();
}


// =========================================================
// 4. 색상 제어
// =========================================================

// "#rrggbb" → vec3(r, g, b)
function hexToVec3(hex)
{
    return vec3(parseInt(hex.substr(1, 2), 16) / 255,
                parseInt(hex.substr(3, 2), 16) / 255,
                parseInt(hex.substr(5, 2), 16) / 255);
}

function paletteToFloats(hexList)
{
    return flatten(hexList.map(hexToVec3));
}

// depthShift를 0으로 줄여가며 이전 색 → 새 색으로 부드럽게 전환
function startColorTransition()
{
    if (colorAnimating) return;
    colorAnimating = true;

    function step() {
        depthShift *= 0.88;
        if (Math.abs(depthShift) < 0.01) depthShift = 0.0;
        render();
        if (depthShift !== 0.0) requestAnimFrame(step);
        else colorAnimating = false;
    }
    requestAnimFrame(step);
}

// 오른쪽 패널의 0 ~ 8 색상 막대 갱신
function updatePaletteView()
{
    var html = "";
    var colors = palettes[paletteIndex];
    for (var i = 0; i <= MaxTimes; i++) {
        html += '<div class="' + (i === NumTimes ? "current" : "") + '">' +
                '<span style="background:' + colors[i] + '"></span>' + i + '</div>';
    }
    document.getElementById("Palette").innerHTML = html;
}


// =========================================================
// 5. 이벤트 리스너
// =========================================================
function setupEventListeners()
{
    // ----- 분할 횟수 -----
    document.getElementById("DepthSlider").addEventListener("input", function (event) {
        if (!growing) setDepth(parseInt(event.target.value));
        else event.target.value = NumTimes;
    });

    document.getElementById("GrowButton").addEventListener("click", startGrowing);

    canvas.addEventListener("click", function (event) {
        if (growing) return;
        var t = getClipPosition(event);
        if (event.shiftKey) mergeAt(t);
        else subdivideAt(t);
        updateHover(t);
    });

    canvas.addEventListener("mousemove", function (event) {
        updateHover(getClipPosition(event));
    });

    canvas.addEventListener("mouseleave", function () {
        hoverBox = vec4(9.0, 9.0, 9.0, 9.0);
        render();
    });

    window.addEventListener("keydown", function (event) {
        if (growing) return;
        if (event.key === "+" || event.key === "=") setDepth(NumTimes + 1);
        if (event.key === "-" || event.key === "_") setDepth(NumTimes - 1);
    });

    // ----- 색상 -----
    var p = document.getElementById("PaletteMenu");
    p.addEventListener("change", function () {
        paletteIndex = p.selectedIndex;
        updatePaletteView();
        render();
    });

    document.getElementById("BgColor").addEventListener("input", function (event) {
        var c = hexToVec3(event.target.value);
        bgColor = vec4(c[0], c[1], c[2], 1.0);
        render();
    });

    var m = document.getElementById("FilterMenu");
    m.addEventListener("change", function () {
        filterMode = m.selectedIndex;
        render();
    });
}

// 마우스가 올라간 사각형을 hoverBox uniform으로 전달
function updateHover(t)
{
    var index = pickSquare(t);
    if (index < 0) {
        hoverBox = vec4(9.0, 9.0, 9.0, 9.0);
    } else {
        var sq = squares[index];
        hoverBox = vec4(sq.x, sq.y, sq.x + sq.size, sq.y + sq.size);
    }
    render();
}

function updateInfo()
{
    var total = 0, minDepth = MaxTimes, maxDepth = 0;
    for (var i = 0; i < squares.length; i++) {
        var sq = squares[i];
        total += Math.pow(8, sq.depth - sq.level);   // shader가 만들어 내는 사각형 포함
        minDepth = Math.min(minDepth, sq.depth);
        maxDepth = Math.max(maxDepth, sq.depth);
    }
    document.getElementById("info").innerHTML =
        "화면상 사각형 수: " + total.toLocaleString() + "개<br>" +
        "GPU 정점 수: " + points.length.toLocaleString() + "개<br>" +
        "분할 횟수 범위: " + minDepth + " ~ " + maxDepth;
}