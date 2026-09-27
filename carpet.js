"use strict";
 
var canvas;
var gl;
var program;
var points=[]; //정점 위치(vec2)
var squares=[]; //그려지는 사각형 목록 

var NumTimes = 3; //전체 분할 횟수
var vBuffer;

window.onload = function init() {
    canvas = document.getElementById("gl-canvas");
    gl = WebGLUtils.setupWebGL(canvas);
    if(!gl) { alert ("WebGL isn't availabel"); return; }
    gl.viewport (0, 0, canvas.width, canvas.height);

    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    var vPosition = gl.getAttribLocation(program, "vPosition");
    gl.vertexAttribPointer(vPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    buildCarpet();
};

//기하 데이터 생성
//사각형 노드
function makeSquare(x,y, size, level, parent){
    return {x: x, y: y, size:size, level: level, parent: parent} ;
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
}

//전체를 numtimes번 균일하게 분할
function buildCarpet() {
    squares = [];
    var root = makeSquare(-0.95, -0.95, 1.9, 0, null);
    divideSqaure(root, NumTimes);
    uploadData();
}

//렌더링
function uploadData() {
    points = [];
    for (var i = 0; i<square.length; i++) square(squares[i]);
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW);

    render();
}

function render() {
    gl.clearColor(0.992, 0.988, 0.973, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, points.length);
}