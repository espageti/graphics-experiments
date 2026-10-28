#version 300 es

layout(location=0) in vec4 position;

uniform mat4 transform;
uniform vec4 color;

uniform float time;

out vec4 vColor;

void main() {
    vColor = color;
    float vary = log(float(gl_VertexID + 2)) * 4.0 ;
    vec4 offset = vec4(cos(time * 2.0 * vary + vary)/10.0, sin(time * 2.0 * vary + vary)/10.0, 0, 0);
    gl_Position = position + offset;
}
