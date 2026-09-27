"use strict";
 
var canvas;
var gl;
var program;
var points=[]; //정점 위치(vec2)
var locals = []; // 사각형 내부 좌표 (vec2, 0 ~ 1)
var levels = []; // 정점으로 분할한 단계 (float)
var depths = []; // 목표 분할 횟수 (float)
var squares = []; // 현재 그려지는 사각형 목록 (잎 노드)

var NumTimes = 3; //전체 분할 횟수
var MaxTimes = 5; //최대 분할 회수
var MaxGeometryLevel = 5; //정점으로 나누는 최대 단계
var vBuffer, localBuffer, levelBuffer, depthBuffer;

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

    setupEventListeners();
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

//기하 데이터 생성
//사각형 노드
function makeSquare(x,y, size, level, parent){
    return { x: x, y: y, size: size, level: level, depth: level, parent: parent };
}

function divideSqaure(sq, count) {
    if (count ===0 ) {
        squares.push(sq);
        return;
    }
    var s = sq.size /3 ;
    for(var row = 0; row <3; row++) {
        for( var col = 0; col<3; col++) {
            if (row === 1 & col ===1 ) continue;
            var child = makeSquare(sq.x + col*s, sq.y + row*s, s, sq.level + 1, sq);
            divideSqaure(child, count -1);
        }
    }
}

//사각형 1개 = 삼각형 2개 = 정점 6개
function square(sq) {
    var a = vec2(sq.x, sq.y);
    var b = vec2(sq.x + sq.size, sq.y);
    var c = vec2(sq.x + sq.size, sq.y + sq.size);
    var d = vec2(sq.x, sq.y + sq.size);
    points.push(a, b, c, a, c, d);

    locals.push(vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 0), vec2(1, 1), vec2(0, 1));
    for (var i = 0; i < 6; i++) {
        levels.push(sq.level);
        depths.push(sq.depth);
    }
}

//전체를 numtimes번 균일하게 분할
function buildCarpet()
{
    squares = [];
    var root = makeSquare(-0.95, -0.95, 1.9, 0, null);
    divideSquare(root, Math.min(NumTimes, MaxGeometryLevel));
    for (var i = 0; i < squares.length; i++) squares[i].depth = NumTimes;
    uploadData();
}

//렌더링
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

function render() {
    gl.clearColor(0.992, 0.988, 0.973, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, points.length);
}

//분할 횟수 제어
function setDepth(n) {
    n =Math.max(0, Math.min(MaxTimes, n));
    if(n === NumTimes) return;
    NumTimes = n;

    document.getElementById("Depthslider").value = n;
    document.getElementById("DepthValue").textContent = n;
    buildCarpet();
}

//EventListener
function setupEventListeners() {
    document.getElementById("DepthSlider").addEventListener("input", function(event) {
        setDepth(parseInt(event.target.value));
    });

    window.addEventListener("keydown", function (event) {
        if(event.key === "+" || event.key ==="=") setDepth(NumTimes + 1);
        if(event.key === "-" || event.key === "_") setDepth(NumTimes - 1);
    });
}

function updateInfo()
{
    var total = 0, minDepth = MaxTimesToSubdivide, maxDepth = 0;
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