import os
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client
url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_KEY')
sb = create_client(url, key)
res = sb.table('topics').select('*').limit(5).execute()
for row in res.data:
    print(row)
    print()
res2 = sb.table('subtopics').select('*').limit(5).execute()
for row in res2.data:
    print(row)
    print()
