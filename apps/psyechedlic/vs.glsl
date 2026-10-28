#version 300 es

out vec4 vPos;
void main() {
    // 0 = (-1, -1)
    // 1 = (1, 1)
    // 2 = (-1, 1)
    // 3 = (-1, -1)
    // 4 = (1, 1)
    // 5 = (1, -1)
    vec4 points[6] = vec4[6](
        vec4(-1.0, -1.0, 0.0, 1.0),
        vec4( 1.0,  1.0, 0.0, 1.0),
        vec4(-1.0,  1.0, 0.0, 1.0),
        vec4(-1.0, -1.0, 0.0, 1.0),
        vec4( 1.0,  1.0, 0.0, 1.0),
        vec4( 1.0, -1.0, 0.0, 1.0)
    );

    gl_Position = points[gl_VertexID];
    vPos = points[gl_VertexID];
}


