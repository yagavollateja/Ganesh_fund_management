export async function audit(conn, user, action, module, recordId, description, oldValues=null, newValues=null) {
  await conn.execute(
    `INSERT INTO audit_logs (user_id,user_name,user_email,action,module,record_id,description,old_values,new_values)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [user.id, user.name, user.email, action, module, recordId, description,
     oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null]
  );
}
