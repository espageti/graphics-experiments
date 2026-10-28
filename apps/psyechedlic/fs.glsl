#version 300 es
precision highp float;


uniform float seconds;
in vec4 vPos;
out vec4 color;
void main() {
    color = vec4(1, 0, 0.5, 1);

    float x = vPos.x;
    float y = vPos.y;
    float value = 0.0;
    for (int i = 100; i <= 100; i++)
    {
        float c1 = mod(4.0, float(i));
        float c2 = mod(25.0, float(i));
        float c3 = mod(8.1, float(i));
        float c4 = mod(23.0, float(i)) ;
        value += cos(y * sin(x * sin(seconds) * c1 * cos(y * c2 * sin(seconds) + c3) * c4) * 4.3);
    }
    color.r = value * sin(seconds * 3.1 * pow(x, 2.0));
    color.g = value * sin(seconds * 3.8 * pow(x, 3.0) * pow(y, 2.0)) + x ;
    color.b = value * cos(seconds * 4.7 * pow(y, 2.0) * x) + y;
}