#version 300 es
in vec3 a_position;
in vec3 a_normal;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_proj;
out vec3 v_normal;
out vec3 v_worldPos;
void main(){
  vec4 wp = u_model * vec4(a_position,1.0);
  v_worldPos = wp.xyz;
  v_normal = mat3(u_model) * a_normal;
  gl_Position = u_proj * u_view * wp;
}
