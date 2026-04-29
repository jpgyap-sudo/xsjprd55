import os
import sys
import psycopg2

DB_PASSWORD = os.environ.get('DB_PASSWORD')
PROJECT_REF = 'nqcgnwpfxnbtdrvtkwej'
# IPv6 direct connect — db.nqcgnwpfxnbtdrvtkwej.supabase.co has no A record
DB_HOST = '2406:da14:271:9922:ba9b:5936:a55b:36a3'
DB_USER = 'postgres'
DB_NAME = 'postgres'
DB_PORT = 5432

SQL_PATH = os.path.join(os.path.dirname(__file__), '..', 'supabase', 'create-missing-tables.sql')

if not DB_PASSWORD:
    print('ERROR: Set DB_PASSWORD env var with your Supabase database password.')
    sys.exit(1)

with open(SQL_PATH, 'r', encoding='utf-8') as f:
    sql = f.read()

conn = None
try:
    print(f'Connecting to {DB_HOST}...')
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER,
        password=DB_PASSWORD, database=DB_NAME,
        sslmode='require'
    )
    conn.autocommit = True
    cur = conn.cursor()
    print('Connected. Executing SQL...')
    cur.execute(sql)
    print('SQL executed successfully.')

    # Verify tables exist
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('product_features', 'deploy_history')
    """)
    rows = cur.fetchall()
    print('\nVerified tables:')
    for row in rows:
        print(f'  ✓ {row[0]}')
    if len(rows) < 2:
        print('  ⚠ Expected product_features and deploy_history — some tables may be missing.')

    cur.close()
except psycopg2.OperationalError as e:
    print(f'ERROR: {e}')
    if 'password authentication failed' in str(e):
        print('The DB_PASSWORD is incorrect.')
    sys.exit(1)
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
finally:
    if conn:
        conn.close()
