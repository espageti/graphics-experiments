// Matrix utility functions for Float32Array (column-major)
function multiplyMatrix4(a, b) {
    const result = new Float32Array(16);
    
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            result[i * 4 + j] = 
                a[i * 4 + 0] * b[0 * 4 + j] +
                a[i * 4 + 1] * b[1 * 4 + j] +
                a[i * 4 + 2] * b[2 * 4 + j] +
                a[i * 4 + 3] * b[3 * 4 + j];
        }
    }
    
    return result;
}

function compileShader(vs_source, fs_source) {
    const vs = gl.createShader(gl.VERTEX_SHADER)
    gl.shaderSource(vs, vs_source)
    gl.compileShader(vs)
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(vs))
        throw Error("Vertex shader compilation failed")
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(fs, fs_source)
    gl.compileShader(fs)
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(fs))
        throw Error("Fragment shader compilation failed")
    }

    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program))
        throw Error("Linking failed")
    }

    // Get uniform locations
    const uniforms = {}
    for(let i=0; i<gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i+=1) {
        let info = gl.getActiveUniform(program, i)
        uniforms[info.name] = gl.getUniformLocation(program, info.name)
    }
    program.uniforms = uniforms

    return program
}


function setupGeometry(geom, attributeName, color) {
    // a "vertex array object" or VAO records various data provision commands
    var triangleArray = gl.createVertexArray()
    gl.bindVertexArray(triangleArray)
    
    // Use the specified attribute (logo or outline)
    const vertexData = geom[attributeName]
    
    // goal 1: get data from CPU memory to GPU memory 
    // createBuffer allocates an array of GPU memory for positions
    // create and remember a buffer for this geometry's vertex data
    let buffer = gl.createBuffer()
    // to get data into the array we tell the GPU which buffer to use
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    // and convert the data to a known fixed-sized type
    let f32 = new Float32Array(vertexData[0].flat())
    // then send that data to the GPU, with a hint that we WILL update it frequently
    gl.bufferData(gl.ARRAY_BUFFER, f32, gl.DYNAMIC_DRAW)
    
    // goal 2: connect the buffer to an input of the vertex shader
    // inputs are numbered in the vertex shader to equal i here
    // telling the GPU how to parse the bytes of the array:
    gl.vertexAttribPointer(0, vertexData[0][0].length, gl.FLOAT, false, 0, 0)
    // and connecting the currently-used array to the VS input
    gl.enableVertexAttribArray(0)


    // We also have to explain how values are connected into shapes.
    // There are other ways, but we'll use indices into the other arrays
    var indices = new Uint16Array(geom.triangles.flat())
    // we'll need a GPU array for the indices too
    var indexBuffer = gl.createBuffer()
    // but the GPU puts it in a different "ready" position, one for indices
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

    console.log(`Created geometry ${attributeName} with ${indices.length/3} triangles`)
    // we return all the bits we'll need to use this work later. Include the
    // CPU-side Float32Array and the GPU buffer so we can update them each frame.
    return {
        mode:gl.TRIANGLES,      // grab 3 indices per triangle
        count:indices.length,   // out of this many indices overall
        type:gl.UNSIGNED_SHORT, // each index is stored as a Uint16
        vao:triangleArray,      // and this VAO knows which buffers to use
        color: color,           // store the color for this geometry
        
        buffer: buffer,
        cpuArray: f32
    }
}

function updateGeom(geom, scale = 0.02) {   
    // updating float32 array
    const arr = geom.cpuArray
    for (let i = 0; i < arr.length; i += 4) {
        arr[i+0] += (Math.random() - 0.5) * scale
        arr[i+1] += (Math.random() - 0.5) * scale
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, geom.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW)
}


// Matrix utility functions
function createTranslationMatrix(x, y, z) {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        x, y, z, 1
    ])
}

function createScaleMatrix(scale) {
    return new Float32Array([
        scale, 0, 0, 0,
        0, scale, 0, 0,
        0, 0, scale, 0,
        0, 0, 0, 1
    ])
}

//just for testing
function createIdentityMatrix() {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ])
}

function createRotationMatrix(angleRad, axis) {
    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);
    const t = 1 - c;
    const [x, y, z] = axis;

    return new Float32Array([
        x * x * t + c,     y * x * t + z * s,   z * x * t - y * s,   0,
        x * y * t - z * s,   y * y * t + c,     z * y * t + x * s,   0,
        x * z * t + y * s,   y * z * t - x * s,   z * z * t + c,     0,
        0,                   0,                   0,                   1
    ]);
}

function draw(milliseconds) {
    gl.clear(gl.COLOR_BUFFER_BIT) 
    gl.useProgram(program)
    
    // Animation matrix applied to everything
    // let animateMatrix = createTranslationMatrix(Math.sin(milliseconds/500)/2, Math.sin(milliseconds/200)/3, 0)
    // animateMatrix = multiplyMatrix4(createRotationMatrix(milliseconds/800, [0,0,1]), animateMatrix)
    // animateMatrix = multiplyMatrix4(createScaleMatrix(0.1+0.9*Math.sin(milliseconds/700)), animateMatrix)
    // Draw the outline 
    gl.bindVertexArray(window.outlineGeom.vao)
    // Update dynamic vertex attribute for outline (CPU-side jitter)
    updateGeom(window.outlineGeom)
    gl.uniform1f(program.uniforms.time, milliseconds/929.0 * 2)
    gl.uniform4fv(program.uniforms.color, window.outlineGeom.color)
    gl.drawElements(window.outlineGeom.mode, window.outlineGeom.count, window.outlineGeom.type, 0)

    // Draw the logo 
    gl.bindVertexArray(window.logoGeom.vao)
    // Update dynamic vertex attribute for logo (CPU-side jitter)
    updateGeom(window.logoGeom)
    gl.uniform1f(program.uniforms.time, milliseconds/763.0 *2)
    gl.uniform4fv(program.uniforms.color, window.logoGeom.color)
    gl.drawElements(window.logoGeom.mode, window.logoGeom.count, window.logoGeom.type, 0)
}

function tick(milliseconds) {
    draw(milliseconds)
    requestAnimationFrame(tick) // asks browser to call tick before next frame
}

window.addEventListener('load', async (event) => {
    window.gl = document.querySelector('canvas').getContext('webgl2')
    let vs = await fetch('vertex.glsl').then(res => res.text())
    let fs = await fetch('fragment.glsl').then(res => res.text())
    window.program = compileShader(vs,fs)
    let data = await fetch('geometry.json').then(r=>r.json())
    
    console.log('Program uniforms:', window.program.uniforms)
    console.log('Geometry data:', data)
    
    // Create two different geometry objects
    window.logoGeom = setupGeometry(data, 'logo', [1.0, 0.373, 0.02, 1.0] )
    window.outlineGeom = setupGeometry(data, 'outline', [0.075, 0.161, 0.292, 1.0])

    requestAnimationFrame(tick) 
})

