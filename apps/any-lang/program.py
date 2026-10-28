from PIL import Image
import sys

if __name__ == "__main__":
    print(f"Script name: {sys.argv[0]}")
    file_object = open(sys.argv[1], "r")
    all_lines = file_object.readlines()
    line = all_lines[0]
    line = line.strip()
    words = line.split()
    width = int(words[1])
    height = int(words[2])
    filename = words[3]

    image = Image.new("RGBA", (width, height), (0,0,0,0))

    positionBuffer = []
    colorBuffer = []
    for line in all_lines[1:]:
        line = line.strip() 
        words = line.split()
        
        match words[0]:
            case "position":
                positionBuffer = []
                for i in range(2, len(words), 2):
                    positionBuffer.append((int(words[i]), int(words[i+1])))
            case "color":
                
                colorBuffer = []
                for i in range(2, len(words), 4):
                    colorBuffer.append((int(words[i]), int(words[i+1]), int(words[i+2]), int(words[i+3])))
            case "drawPixels":
                for i in range(int(words[1])):
                    # print(i, positionBuffer, colorBuffer)
                    image.im.putpixel(positionBuffer[i], colorBuffer[i])
    
    image.save(filename)


# width = 4
# height = 6

# # ...
# image = Image.new("RGBA", (width, height), (0,0,0,0))
# # ...
# image.im.putpixel((x,y), (red, green, blue, alpha))
# # ...
# image.save(filename)