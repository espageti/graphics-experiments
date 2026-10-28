#version 300 es
precision mediump float;
in float v_h;
out vec4 outColor;
void main(){
  float t = clamp((v_h + 0.5), 0.0, 1.0);
  vec3 deep = vec3(0.02,0.08,0.18);
  vec3 light = vec3(0.4,0.8,1.0);
  vec3 c = mix(deep, light, t);
  outColor = vec4(c, 1.0);
}
