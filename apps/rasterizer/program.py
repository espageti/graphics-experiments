from unittest import case
from PIL import Image
import sys

import numpy as np


def dda(a:np.array, b:np.array, d:np.array, step8=False):
    if (not any(a - b)):
        return None, None
    if(a[d] > b[d]):
        a, b = b, a
    delta = b - a
    
    # Check for division by zero
    if abs(delta[d]) < 1e-10:
        return None, None
        
    s = delta / delta[d]
    e = np.ceil(a[d]) - a[d]
    o = e * s
    p = a + o
    if(not step8):
        return p, s

    points = []
    while(p[d] < b[d]):
        points.append(np.array(p))
        p += s
    return points

def scanline(p:np.array, q:np.array, r:np.array):
    sorted_points = sorted([p, q, r], key=lambda point: point[1])
    print("Sorted points:", sorted_points)
    t = sorted_points[0]
    m = sorted_points[1]
    b = sorted_points[2]
    if(not any(t - m) or not any(m - b) or not any(t - b)):
        return []
    pLong, sLong = dda(t, b, 1)
    if pLong is None or not np.any(pLong):
        return []
    p, s = dda(t, m, 1)
    if p is None or not np.any(p):
        return []
    points = []
    while(p[1] < m[1]):
        newPoints = dda(p, pLong, 0, True)
        if(newPoints):
            points += newPoints
        
        p += s
        pLong += sLong
    p, s = dda(m, b, 1)
    if p is None or not np.any(p):
        print("What's going on?")
        print(t,m,b)
        return []
    while(p[1] < b[1]):
        newPoints = dda(p, pLong, 0, True)
        if(newPoints):
            points += newPoints
        p += s
        pLong += sLong
    return points

def linear_to_srgb(c):
    if(c <= 0.0031308):
        return 12.92 * c
    else:
        return 1.055 * (c ** (1/2.4)) - 0.055


def clipTriangleAgainstPlane(points, planeIndex, planeSign):  #returns a list of triangles, each triangle is a list of three np.array
    global wIndex
    
    # Check for empty or invalid input
    if not points or len(points) != 3:
        return [[]]
        
    # planeSign is either 1 or -1
    # x >= -w
    # w + x >= 0
    # x <= w
    # w - x >= 0
    signedDistances = []
    for i in range(3):
        print("Clipping against plane", planeSign * points[i][planeIndex], points[i][wIndex]* planeSign)

        signedDistances.append(planeSign * points[i][planeIndex] + points[i][wIndex])
    
    inBoundPoints = []
    for i in range(3):
        if(signedDistances[i] >= 0):
            inBoundPoints.append(i)
    print(len(inBoundPoints), "points in bounds")
    if(len(inBoundPoints) == 0): # all out of bounds
        return [[]]
    elif(len(inBoundPoints) == 3): # all in bounds
        return [[p * 1 for p in points]] # return a copy of the list
    elif(len(inBoundPoints) == 1):
        newTriangle = []
        inPointIndex = inBoundPoints[0]
        inPoint = points[inBoundPoints[0]]
        newTriangle.append(inPoint * 1)
        for i in range(3):
            if(i == inBoundPoints[0]):
                continue
            cullPoint = points[i]
            
            # Correct interpolation: t = -d_in / (d_out - d_in)
            denominator = signedDistances[i] - signedDistances[inPointIndex]
            if abs(denominator) < 1e-10:
                continue  # Skip if denominator is too small
            t = -signedDistances[inPointIndex] / denominator
            
            # Debug large t values that cause coordinate explosion
            if abs(t) > 10:
                print(f"WARNING: Large t value = {t:.6f}")
                print(f"Interpolating: inDist={signedDistances[inPointIndex]:.6f}, outDist={signedDistances[i]:.6f}")
                print(f"InPoint: {inPoint}")
                print(f"OutPoint: {cullPoint}")
            
            newPoint = inPoint + t * (cullPoint - inPoint)
            print("New Point Sign", newPoint[wIndex], newPoint[planeIndex],  planeSign)
            newTriangle.append(newPoint)
        return [newTriangle]
    elif(len(inBoundPoints) == 2):
        newPoints = []
        inPoint1 = points[inBoundPoints[0]]
        inPoint2 = points[inBoundPoints[1]]
        for i in range(3):
            if(i == inBoundPoints[0] or i == inBoundPoints[1]):
                continue
            cullPoint = points[i]
            # Correct interpolation for both in-bound points
            denominator1 = signedDistances[i] - signedDistances[inBoundPoints[0]]
            denominator2 = signedDistances[i] - signedDistances[inBoundPoints[1]]
            
            if abs(denominator1) < 1e-10 or abs(denominator2) < 1e-10:
                continue  # Skip if denominators are too small
                
            t1 = -signedDistances[inBoundPoints[0]] / denominator1
            t2 = -signedDistances[inBoundPoints[1]] / denominator2
            
            # Debug large t values
            if abs(t1) > 10 or abs(t2) > 10:
                print(f"WARNING: Large t values = {t1:.6f}, {t2:.6f}")
                print(f"InDist1={signedDistances[inBoundPoints[0]]:.6f}, InDist2={signedDistances[inBoundPoints[1]]:.6f}, OutDist={signedDistances[i]:.6f}")
            
            newPoint1 = inPoint1 + t1 * (cullPoint - inPoint1)
            newPoint2 = inPoint2 + t2 * (cullPoint - inPoint2)

            newPoints.append([newPoint1, newPoint2, inPoint1 * 1]) # multiply by 1 to copy the array
            newPoints.append([newPoint2, inPoint2, inPoint1 * 1])
            print("New Point 1 Sign", newPoint1[wIndex], newPoint1[planeIndex], planeSign)
            print("New Point 2 Sign", newPoint2[wIndex], newPoint2[planeIndex], planeSign)
        return newPoints

depthIndex = 2
colorIndex = 4
wIndex = 3

def clipAndDrawTriangle(points): # points is a list of three np.array
    global frustum
    if(not frustum):
        drawTriangle(points)
        return
    # clip against 6 planes
    planes = [(0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1)]
    triangles = [points]
    for plane in planes:
        newTriangles = []
        for triangle in triangles:
            # Skip empty triangles
            if not triangle or len(triangle) != 3:
                continue
            print("Clipping triangle:", triangle, "against plane", plane)
            clippedTriangles = clipTriangleAgainstPlane(triangle, plane[0], plane[1])
            print("Clipped triangles:")
            for clipped in clippedTriangles:
                print(clipped)
                # Only add non-empty triangles
                if clipped and len(clipped) == 3:
                    newTriangles.append(clipped)

        triangles = newTriangles
    for triangle in triangles:
        print("Drawing triangle", triangle)
        drawTriangle(triangle)
    return

def drawTriangle(points): # points is a list of three np.array
    global width, height, image, colorIndex, wIndex
    global depth, depthBuffer, depthIndex
    global hyp
    for p in points:
                        
        w = p[wIndex]
        
        # Safety check for very small w values to prevent coordinate explosion
        if abs(w) < 1e-6:
            print(f"Warning: Very small w value {w}, skipping triangle")
            return
            
        # Correct perspective division
        if(not hyp):
            # For non-hyperbolic: divide everything by w
            p /= w
        else:
            # For hyperbolic: preserve 1/w for correct interpolation
            p[wIndex] = 1.0 / w
            for i in range(wIndex):
                p[i] /= w
            # Colors stay as is for hyperbolic interpolation
        
        # Convert to screen coordinates
        p[0] = (p[0] + 1) * width/2
        p[1] = (p[1] + 1) * height/2

    pixels = scanline(points[0], points[1], points[2])
    if(pixels):
        for p in pixels:
            if(p is None):
                continue
            if(hyp):
                overW = p[wIndex]
                for i in range(wIndex, len(p)):
                    p[i] /= overW
            for i in range(colorIndex, colorIndex + 4):
                global sRGB
                if(sRGB):
                    p[i] = linear_to_srgb(p[i]) * 255
                else:
                    p[i] *= 255
                
            
            if(p[0] >= width or p[1] >= height or p[0] < 0 or p[1] < 0):
                continue
            if(p[depthIndex] < depthBuffer[int(p[1])*width + int(p[0])]):
                image.im.putpixel((int(p[0]), int(p[1])), (int(p[colorIndex]), 
                                                        int(p[colorIndex+1]), 
                                                        int(p[colorIndex+2]), 
                                                        int(p[colorIndex+3])))
                if(depth):
                    depthBuffer[int(p[1])*width + int(p[0])] = p[depthIndex]
    return

if __name__ == "__main__":
    global positionBuffer, colorBuffer, elementBuffer
    positionBuffer = [] # the buffer is (x, y, z, w) right now
    colorBuffer = []
    elementBuffer = []
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


    #elective stuff
    global depth, depthBuffer
    depth = False
    depthBuffer = [float('inf') for _ in range(width*height)]
    global sRGB
    sRGB = False
    global hyp
    hyp = False
    global frustum
    frustum = False
    global textureFile
    textureFile = None

    global texCoordIndex
    texCoordIndex = 8  # Starting index for texture coordinates in the vertex array
    global texCoordBuffer
    texCoordBuffer = []

    image = Image.new("RGBA", (width, height), (0,0,0,0))

    
    for line in all_lines[1:]:
        line = line.strip()
        if not line or line[0] == "#":
            continue
        words = line.split()
        
        match words[0]:
            case "position":
                positionBuffer = []
                size = int(words[1])
                idx = 0
                for i in range(2, len(words), size):
                    positionBuffer.append(np.array([0, 0, 0, 1], dtype=np.float64)) # default positions
                    for j in range(size):
                        positionBuffer[idx][j] = float(words[i + j])
                    idx += 1
            case "color":
                colorBuffer = []
                size = int(words[1])
                idx = 0
                for i in range(2, len(words), size):
                    colorBuffer.append(np.array([0, 0, 0, 1], dtype=np.float64)) # default values
                    for j in range(size):
                        colorBuffer[idx][j] = float(words[i + j])
                    idx += 1
            case "drawPixels":
                for i in range(int(words[1])):
                    # print(i, positionBuffer, colorBuffer)
                    image.im.putpixel(positionBuffer[i], colorBuffer[i])
            case "elements":
                elementBuffer = []
                for i in range(1, len(words)):
                    elementBuffer.append(int(words[i]))
            case "frustum":
                frustum = True
            case "depth":
                depth = True
            case "sRGB":
                sRGB = True
            case "hyp":
                hyp = True
            case "texture":
                textureFile = words[1]
            case "texcoord":
                texCoordBuffer = []
                size = int(words[1])
                idx = 0
                for i in range(2, len(words), size):
                    texCoordBuffer.append(np.array([0, 0], dtype=np.float64)) # default values
                    for j in range(size):
                        texCoordBuffer[idx][j] = float(words[i + j])
                    idx += 1
            case "drawArraysTriangles":
                first = int(words[1])
                count = int(words[2])
                for i in range(int(count/3)):
                    idx = first + i * 3
                    points = [positionBuffer[idx], positionBuffer[idx+1], positionBuffer[idx+2]]
                    if(idx < len(colorBuffer)):
                        for i in range(3):
                            points[i] = np.concatenate([points[i], colorBuffer[idx + i]])
                    if(idx < len())
                    if(idx < len(texCoordBuffer)):
                        print("Using texture coordinates:", texCoordBuffer[idx], texCoordBuffer[idx+1], texCoordBuffer[idx+2])
                        points = [  np.concatenate([positionBuffer[idx], colorBuffer[idx], texCoordBuffer[idx]]), 
                                np.concatenate([positionBuffer[idx+1], colorBuffer[idx+1], texCoordBuffer[idx+1]]), 
                                np.concatenate([positionBuffer[idx+2], colorBuffer[idx+2], texCoordBuffer[idx+2]])]
                    else:
                        points = [  np.concatenate([positionBuffer[idx], colorBuffer[idx]]), 
                                    np.concatenate([positionBuffer[idx+1], colorBuffer[idx+1]]), 
                                    np.concatenate([positionBuffer[idx+2], colorBuffer[idx+2]])]
                    clipAndDrawTriangle(points)
            case "drawElementsTriangles":
                count = int(words[1])
                offset = int(words[2])
                for i in range(offset, offset + count, 3):
                    if(i < len(texCoordBuffer)):
                        print("Using texture coordinates:", texCoordBuffer[i], texCoordBuffer[i+1], texCoordBuffer[i+2])
                        points = [  np.concatenate([positionBuffer[elementBuffer[i]], colorBuffer[elementBuffer[i]], texCoordBuffer[elementBuffer[i]]]), 
                                np.concatenate([positionBuffer[elementBuffer[i+1]], colorBuffer[elementBuffer[i+1]], texCoordBuffer[elementBuffer[i+1]]]), 
                                np.concatenate([positionBuffer[elementBuffer[i+2]], colorBuffer[elementBuffer[i+2]], texCoordBuffer[elementBuffer[i+2]]])]
                    else:
                        points = [  np.concatenate([positionBuffer[elementBuffer[i]], colorBuffer[elementBuffer[i]]]), 
                                    np.concatenate([positionBuffer[elementBuffer[i+1]], colorBuffer[elementBuffer[i+1]]]), 
                                    np.concatenate([positionBuffer[elementBuffer[i+2]], colorBuffer[elementBuffer[i+2]]])]
                    clipAndDrawTriangle(points)
    image.save(filename)


# width = 4
# height = 6

# # ...
# image = Image.new("RGBA", (width, height), (0,0,0,0))
# # ...
# image.im.putpixel((x,y), (red, green, blue, alpha))
# # ...
# image.save(filename)