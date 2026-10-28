#version 300 es

layout(location=0) in vec4 position;

uniform mat4 transform;
uniform vec4 color;

out vec4 vColor;

void main() {
    vColor = color;
    gl_Position = transform * position;
}
