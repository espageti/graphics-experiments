from operator import ior
from unittest import case
from PIL import Image
import sys

import numpy as np
from collections import namedtuple


forward_vector = np.array([0,0,-1])
up_vector = np.array([0,1,0])
right_vector = np.array([1,0,0])
eye_position = np.array([0,0,0])

materials_info = ["color", "shininess", "transparency", "ior"]
Sphere = namedtuple("Sphere", ["center", "radius"] + materials_info)
Plane = namedtuple("Plane", ["point", "normal"] + materials_info)
Triangle = namedtuple("Triangle", ["v0", "v1", "v2"] + materials_info)
objects = []

def raycast(ray_origin, ray_direction, ignore_object=None):
    min_t = float('inf')
    hit_object = None
    normal = None
    for object in objects:
        if(object is ignore_object):
            continue
        if isinstance(object, Sphere):
            inside = np.linalg.norm(object.center - ray_origin) ** 2 < object.radius ** 2
            t_c = np.dot(object.center - ray_origin, ray_direction)/np.linalg.norm(ray_direction)
            if (not inside and t_c < 0):
                continue
            d_squared = np.linalg.norm(ray_origin + t_c*ray_direction - object.center) ** 2
            if not inside and d_squared > object.radius ** 2:
                continue
            t_offset = np.sqrt(object.radius ** 2 - d_squared)/np.linalg.norm(ray_direction)
            if inside:
                t = t_c + t_offset
            else:
                t = t_c - t_offset
            if t < min_t and t > 0:
                min_t = t
                hit_object = object
                normal = (ray_origin + t*ray_direction - object.center)/object.radius
        elif isinstance(object, Plane):
            denom = np.dot(object.normal, ray_direction)
            if abs(denom) > 1e-6:
                t = np.dot(object.point - ray_origin, object.normal) / denom
                if t < min_t and t > 0:
                    min_t = t
                    hit_object = object
                    normal = object.normal
        elif isinstance(object, Triangle):
            edge1 = object.v1 - object.v0
            edge2 = object.v2 - object.v0
            ray_cross_e2 = np.cross(ray_direction, edge2)
            det = np.dot(edge1, ray_cross_e2)
            if abs(det) < 1e-6:
                continue
            inv_det = 1.0 / det
            s = ray_origin - object.v0
            u = inv_det * np.dot(s, ray_cross_e2)
            if u < 0.0 or u > 1.0:
                continue
            s_cross_e1 = np.cross(s, edge1)
            v = inv_det * np.dot(ray_direction, s_cross_e1)
            if v < 0.0 or u + v > 1.0:
                continue
            t = inv_det * np.dot(edge2, s_cross_e1)
            if t < min_t and t > 0:
                min_t = t
                hit_object = object
                normal = np.cross(edge1, edge2)
                normal = normal / np.linalg.norm(normal)    
        

    return hit_object, min_t, normal

def convertTosRGB(color):
    Llinear = color
    if Llinear <= 0.0031308:
        LsRGB = 12.92 * Llinear
    else:
        LsRGB = 1.055 * (Llinear ** (1.0 / 2.4)) - 0.055
    return LsRGB

Sun = namedtuple("Sun", ["direction", "color"])
Bulb = namedtuple("Bulb", ["position", "color"])
lightSources = []

bounces = 4

def colorOfRay(origin, direction, depth, getIOR=False):
    hit_object, t, normal = raycast(origin, direction)
    point = origin + t*direction
    rayColor = np.array([0.0, 0.0, 0.0])
    if hit_object is not None:
        
        if np.dot(normal, direction) > 0:
            normal = -normal
        for lightSource in lightSources:
            
            if(isinstance(lightSource, Sun)):
                lightDir = lightSource.direction
                lightDistance = float('inf')
            else:
                lightDir = lightSource.position - point
                lightDistance = np.linalg.norm(lightDir)
                lightDir = lightDir / lightDistance
            
            if raycast(point, lightDir, hit_object)[1] < lightDistance:
                continue
            
            lightColor = lightSource.color
            if(isinstance(lightSource, Bulb)):
                attenuation = 1.0 / (lightDistance **2)
                lightColor = lightColor * attenuation
            rayColor += hit_object.color * lightColor * max(0, np.dot(normal, lightDir))
        if depth < bounces:
            reflectDir = direction - 2 * np.dot(direction, normal) * normal
            reflectDir = reflectDir / np.linalg.norm(reflectDir)
            shininess = hit_object.shininess
            reflectedColor = colorOfRay(point + 1e-4*reflectDir, reflectDir, depth + 1)
            
            diffuse = (1 - shininess)

            #Transparency: This is a bit doomed I think
            ior = hit_object.ior
            direction = direction / np.linalg.norm(direction)
            normal = normal / np.linalg.norm(normal)
            e = -direction
            a = np.dot(e, normal)
            eta = 1 / ior if np.dot(direction, normal) < 0 else ior #whether it's entering or leaving from air to material
            b= eta * np.sqrt(max(0.0, 1 - a * a))
            if(b >= 1.0):
                #Total internal reflection
                refractDir = 2 *a * normal - e
                refractDir = refractDir / np.linalg.norm(refractDir)
            else:
                c = np.sqrt(max(0.0, 1 - b * b))
                refractDir = eta * (-e - a * normal) - c * normal
                refractDir = refractDir / np.linalg.norm(refractDir)
            refractedColor = colorOfRay(point + 1e-4*refractDir, refractDir, depth + 1)
            transparency = hit_object.transparency
            rayColor = (rayColor * (1 - transparency) + refractedColor * transparency) * diffuse + reflectedColor * shininess
    
    return rayColor
    

fisheye = False
panorama = False

exposure = None
if __name__ == "__main__":

    print(sys.argv)
    print(f"Script name: {sys.argv[0]}")
    file_object = open(sys.argv[1], "r")
    all_lines = file_object.readlines()
    line = all_lines[0]
    line = line.strip()
    words = line.split()
    global width, height, image
    width = int(words[1])
    height = int(words[2])
    filename = words[3]

    image = Image.new("RGBA", (width, height), (0,0,0,0))


    
    curr_color = np.array([1.0, 1.0, 1.0])
    curr_shininess = np.array([0.0, 0.0, 0.0])
    curr_transparency = np.array([0.0, 0.0, 0.0])
    curr_ior = 1.458


    indices = []
    for line in all_lines[1:]:
        line = line.strip()
        if not line or line[0] == "#":
            continue
        words = line.split()
        
        match words[0]:
            #Mode setting
            case "expose":
                exposure = float(words[1])
            case "eye":
                eye_position = np.array([float(words[1]), float(words[2]), float(words[3])])
            case "forward":
                forward_vector = np.array([float(words[1]), float(words[2]), float(words[3])])
                print("Forward Vector Updated:", forward_vector)
                right_vector = np.cross(forward_vector, up_vector)
                print("Right Vector Updated:", right_vector)
                right_vector = right_vector / np.linalg.norm(right_vector) # normalize
                print("Right Vector Updated:", right_vector)
                up_vector = np.cross(right_vector, forward_vector)
                up_vector = up_vector / np.linalg.norm(up_vector) # normalize
                print("Up Vector Updated:", up_vector)
            case "up":
                up_vector = np.array([float(words[1]), float(words[2]), float(words[3])])
                print("Up Vector Updated:", up_vector)
                right_vector = np.cross(forward_vector, up_vector)
                right_vector = right_vector / np.linalg.norm(right_vector)
                up_vector = np.cross(right_vector, forward_vector)
                up_vector = up_vector / np.linalg.norm(up_vector)
            case "fisheye":
                fisheye = True
            case "panorama":
                panorama = True
            case "bounces":
                bounces = int(words[1])
            # State Setting
            case "color":
                r = float(words[1])
                g = float(words[2])
                b = float(words[3])
                curr_color = np.array([r, g, b])
            case "shininess":
                if(len(words) == 2):
                    shininess_value = float(words[1])
                    curr_shininess = np.array([shininess_value, shininess_value, shininess_value])
                    continue
                r = float(words[1])
                g = float(words[2])
                b = float(words[3])
                curr_shininess = np.array([r, g, b])
            case "transparency":
                if(len(words) == 2):
                    transparency_value = float(words[1])
                    curr_transparency = np.array([transparency_value, transparency_value, transparency_value])
                    continue
                r = float(words[1])
                g = float(words[2])
                b = float(words[3])
                curr_transparency = np.array([r, g, b])
            case "ior":
                curr_ior = float(words[1])
            # Geometry 
            case "sphere":
                x = float(words[1])
                y = float(words[2])
                z = float(words[3])
                radius = float(words[4])
                sphere = Sphere(center=np.array([x,y,z]), radius=radius, color=curr_color.copy(), shininess=curr_shininess.copy(), transparency=curr_transparency.copy(), ior=curr_ior)
                objects.append(sphere)
            case "sun":
                sunDir = np.array([float(words[1]), float(words[2]), float(words[3])])
                sunColor = curr_color.copy()
                sunDir = sunDir / np.linalg.norm(sunDir) # normalize
                lightSources.append(Sun(direction=sunDir, color=sunColor))
            case "bulb":
                bulbPos = np.array([float(words[1]), float(words[2]), float(words[3])])
                bulbColor = curr_color.copy()
                lightSources.append(Bulb(position=bulbPos, color=bulbColor))
            case "plane":
                A = float(words[1])
                B = float(words[2])
                C = float(words[3])
                D = float(words[4])
                point_on_plane = -np.array([A*D, B*D, C*D])/(A**2 + B**2 + C**2)
                normal_vector = np.array([A, B, C])
                normal_vector = normal_vector / np.linalg.norm(normal_vector)
                plane = Plane(point=point_on_plane, normal=normal_vector, color=curr_color.copy(), shininess=curr_shininess.copy(), transparency=curr_transparency.copy(), ior=curr_ior)
                objects.append(plane)
            case "xyz":
                indices.append(np.array([float(words[1]), float(words[2]), float(words[3])]))
            case "tri":
                i0 = int(words[1])
                i1 = int(words[2])
                i2 = int(words[3])
                print(i0, i1, i2, indices)
                if(i0 < 0):
                    i0 += len(indices)
                else:
                    i0 = i0 - 1
                if(i1 < 0):
                    i1 += len(indices)
                else:
                    i1 = i1 - 1
                if(i2 < 0):
                    i2 += len(indices)
                else:
                    i2 = i2 - 1
                v0 = indices[i0]
                v1 = indices[i1]
                v2 = indices[i2]
                triangle = Triangle(v0=v0, v1=v1, v2=v2, color=curr_color.copy(), shininess=curr_shininess.copy(), transparency=curr_transparency.copy(), ior=curr_ior)
                objects.append(triangle)
            case _:
                pass

    print("Eye Position:", eye_position)
    print("Forward Vector:", forward_vector)
    print("Up Vector:", up_vector)
    print("Right Vector:", right_vector)
    #render
    for y in range(height):
        for x in range(width):
            scalar_x = (2*x - width)/max(width, height)
            scalar_y = (height - 2*y)/max(width, height)
            
            if fisheye:
                rsquare = scalar_x**2 + scalar_y**2
                if rsquare > 1.0:
                    continue
                f = forward_vector
                f = (np.sqrt(1 - rsquare))*forward_vector
                ray_dir = (f + scalar_x * right_vector + scalar_y*up_vector)
            elif panorama:
                theta = -scalar_x * np.pi + (np.pi)
                phi = scalar_y * np.pi
                dir_x = np.cos(phi) * np.sin(theta)
                dir_y = np.sin(phi)
                dir_z = -np.cos(phi) * np.cos(theta)
                ray_dir = dir_x*right_vector + dir_y*up_vector + dir_z*forward_vector   
            else:
                ray_dir = (forward_vector + scalar_x * right_vector + scalar_y*up_vector)
                ray_dir = ray_dir / np.linalg.norm(ray_dir) # normalize
            pixelColor = colorOfRay(eye_position, ray_dir, 0)
            if(exposure is not None):
                pixelColor = 1.0 - np.exp(-pixelColor * exposure)
            pixelColor = np.array([convertTosRGB(pixelColor[0]), convertTosRGB(pixelColor[1]), convertTosRGB(pixelColor[2])])

            np.clip(pixelColor, 0.0, 1.0)
            
            red = int(pixelColor[0] * 255)
            green = int(pixelColor[1] * 255)
            blue = int(pixelColor[2] * 255)
            alpha = 255
            image.im.putpixel((x,y), (red, green, blue, alpha))
    image.save(filename)


# width = 4
# height = 6

# # ...
# image = Image.new("RGBA", (width, height), (0,0,0,0))
# # ...
# image.im.putpixel((x,y), (red, green, blue, alpha))
# # ...
# image.save(filename)