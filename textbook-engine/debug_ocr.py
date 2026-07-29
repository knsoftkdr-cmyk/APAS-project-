import pytesseract
from pdf2image import convert_from_bytes

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract_OCR\tesseract.exe'
POPPLER_PATH = r'C:\Program Files\Poppler\poppler-26.02.0\Library\bin'

with open(r'C:\Users\HP\OneDrive\Documents\curriculum-processor\backend\temp_storage\social class 3 sem 1 chapter 1.pdf', 'rb') as f:
    data = f.read()

images = convert_from_bytes(data, dpi=150, poppler_path=POPPLER_PATH)

for i, img in enumerate(images[:4]):
    text = pytesseract.image_to_string(img)
    print(f'=== PAGE {i+1} ===')
    print(repr(text[:800]))
    print()