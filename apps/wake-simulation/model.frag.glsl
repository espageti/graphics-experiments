#version 300 es
precision mediump float;
in vec3 v_normal;
in vec3 v_worldPos;
uniform vec3 u_light;
out vec4 o;
void main(){
  vec3 n = normalize(v_normal);
  vec3 l = normalize(u_light - v_worldPos);
  float lam = max(dot(n,l), 0.0);
  vec3 base = vec3(0.6,0.5,0.4);
  vec3 col = base * (0.2 + 0.8*lam);
  o = vec4(col,1.0);
}
