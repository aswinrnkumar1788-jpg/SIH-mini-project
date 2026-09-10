from flask import Flask, render_template, request, jsonify
import sqlite3
from datetime import datetime, timedelta

app = Flask(__name__)

def init_db():
    with sqlite3.connect('visitors.db') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS visitors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                host TEXT NOT NULL,
                purpose TEXT NOT NULL,
                entry_time TEXT NOT NULL,
                exit_time TEXT DEFAULT '-',
                deadline_time TEXT NOT NULL,
                is_extended INTEGER DEFAULT 0,
                extension_note TEXT DEFAULT '',
                duration TEXT DEFAULT 'Active',
                status TEXT DEFAULT 'Inside'
            )
        ''')
        # Migrate schema safely if upgrading existing table
        cursor.execute("PRAGMA table_info(visitors)")
        cols = [c[1] for c in cursor.fetchall()]
        if 'deadline_time' not in cols:
            cursor.execute("ALTER TABLE visitors ADD COLUMN deadline_time TEXT DEFAULT ''")
        if 'is_extended' not in cols:
            cursor.execute("ALTER TABLE visitors ADD COLUMN is_extended INTEGER DEFAULT 0")
        if 'extension_note' not in cols:
            cursor.execute("ALTER TABLE visitors ADD COLUMN extension_note TEXT DEFAULT ''")
        conn.commit()

init_db()

TIME_FORMAT = "%d-%m-%Y %I:%M %p"

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/pass/<int:v_id>')
def view_pass(v_id):
    with sqlite3.connect('visitors.db') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, name, phone, host, purpose, entry_time, exit_time, deadline_time, is_extended, extension_note, status 
            FROM visitors WHERE id = ?
        ''', (v_id,))
        row = cursor.fetchone()
    
    if not row:
        return "<h3>Pass not found</h3>", 404
        
    visitor = {
        "id": row[0], "name": row[1], "phone": row[2], "host": row[3],
        "purpose": row[4], "entry_time": row[5], "exit_time": row[6],
        "deadline_time": row[7], "is_extended": bool(row[8]),
        "extension_note": row[9], "status": row[10]
    }
    return render_template('pass.html', v=visitor)

@app.route('/api/visitor', methods=['POST'])
def add_visitor():
    data = request.json
    
    if data.get('manual_entry_time'):
        try:
            entry_dt = datetime.strptime(data['manual_entry_time'], "%Y-%m-%dT%H:%M")
        except Exception:
            entry_dt = datetime.now()
    else:
        entry_dt = datetime.now()
        
    # Default 1-hour authorized deadline from entry timestamp
    deadline_dt = entry_dt + timedelta(hours=1)
    
    entry_str = entry_dt.strftime(TIME_FORMAT)
    deadline_str = deadline_dt.strftime(TIME_FORMAT)

    with sqlite3.connect('visitors.db') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO visitors (name, phone, host, purpose, entry_time, exit_time, deadline_time, is_extended, extension_note, duration, status)
            VALUES (?, ?, ?, ?, ?, '-', ?, 0, '', 'Active', 'Inside')
        ''', (data['name'].strip(), data['phone'].strip(), data['host'].strip(), data['purpose'].strip(), entry_str, deadline_str))
        conn.commit()
        new_id = cursor.lastrowid

    return jsonify({
        "message": "Visitor check-in authorized.",
        "pass_id": new_id,
        "entry_time": entry_str,
        "deadline_time": deadline_str
    }), 201

@app.route('/api/visitors', methods=['GET'])
def get_visitors():
    with sqlite3.connect('visitors.db') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, name, phone, host, purpose, entry_time, exit_time, deadline_time, is_extended, extension_note, duration, status 
            FROM visitors ORDER BY id DESC
        ''')
        rows = cursor.fetchall()

    visitors = [{
        "id": r[0], "name": r[1], "phone": r[2], "host": r[3],
        "purpose": r[4], "entry_time": r[5], "exit_time": r[6],
        "deadline_time": r[7], "is_extended": bool(r[8]),
        "extension_note": r[9], "duration": r[10], "status": r[11]
    } for r in rows]
    return jsonify(visitors)

@app.route('/api/extend/<int:v_id>', methods=['POST'])
def extend_stay(v_id):
    data = request.json or {}
    extra_minutes = int(data.get('extra_minutes', 60))
    reason = data.get('reason', 'Host approved extension').strip()

    with sqlite3.connect('visitors.db') as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT deadline_time, status FROM visitors WHERE id = ?", (v_id,))
        row = cursor.fetchone()

        if not row:
            return jsonify({"error": "Pass ID not found"}), 404
        if row[1] != 'Inside':
            return jsonify({"error": "Cannot extend a completed visit"}), 400

        try:
            curr_deadline = datetime.strptime(row[0], TIME_FORMAT)
        except Exception:
            curr_deadline = datetime.now()

        new_deadline = curr_deadline + timedelta(minutes=extra_minutes)
        new_deadline_str = new_deadline.strftime(TIME_FORMAT)

        note_str = f"+{extra_minutes}m ({reason})"

        cursor.execute('''
            UPDATE visitors 
            SET deadline_time = ?, is_extended = 1, extension_note = ? 
            WHERE id = ?
        ''', (new_deadline_str, note_str, v_id))
        conn.commit()

    return jsonify({
        "message": f"Stay extended until {new_deadline_str}",
        "new_deadline": new_deadline_str
    })

@app.route('/api/checkout/<int:v_id>', methods=['POST'])
def checkout_visitor(v_id):
    data = request.json or {}
    
    if data.get('manual_exit_time'):
        try:
            exit_dt = datetime.strptime(data['manual_exit_time'], "%Y-%m-%dT%H:%M")
        except Exception:
            exit_dt = datetime.now()
    else:
        exit_dt = datetime.now()

    exit_str = exit_dt.strftime(TIME_FORMAT)

    with sqlite3.connect('visitors.db') as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT entry_time, status FROM visitors WHERE id = ?", (v_id,))
        row = cursor.fetchone()

        if not row:
            return jsonify({"error": "Pass ID not found"}), 404
        if row[1] == 'Checked Out':
            return jsonify({"error": "Already checked out"}), 400

        duration_str = "Completed"
        try:
            entry_dt = datetime.strptime(row[0], TIME_FORMAT)
            mins = int((exit_dt - entry_dt).total_seconds() // 60)
            duration_str = f"{mins}m" if mins < 60 else f"{mins // 60}h {mins % 60}m"
        except Exception:
            pass

        cursor.execute('''
            UPDATE visitors 
            SET status = 'Checked Out', exit_time = ?, duration = ? 
            WHERE id = ?
        ''', (exit_str, duration_str, v_id))
        conn.commit()

    return jsonify({"message": f"Pass #{v_id} cleared."})

if __name__ == '__main__':
    app.run(debug=True)