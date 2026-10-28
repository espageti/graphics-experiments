#version 300 es

layout(location=0) in vec4 position;

uniform mat4 transform;
uniform vec4 color;

uniform float time;

out vec4 vColor;

void main() {
    vColor = color;
    // Simple matrix multiply only (allowed): transform position by the uniform transform
    gl_Position = position;
}
