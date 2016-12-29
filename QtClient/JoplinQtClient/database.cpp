#include "database.h"

using namespace jop;

Database::Database(const QString &path) {
	version_ = -1;

	//QFile::remove(path);

	db_ = QSqlDatabase::addDatabase("QSQLITE");
	db_.setDatabaseName(path);

	if  (!db_.open()) {
		qDebug() << "Error: connection with database fail";
	} else {
		qDebug() << "Database: connection ok";
	}

	upgrade();
}

Database::Database() {}

QSqlQuery Database::query(const QString &sql) const	{
	QSqlQuery output(db_);
	output.prepare(sql);
	return output;
}

QSqlDatabase &Database::database() {
	return db_;
}

QSqlQuery Database::buildSqlQuery(Database::QueryType type, const QString &tableName, const QStringList &fields, const VariantVector &values, const QString &whereCondition) {
	QString sql;

	if (type == Insert) {
		QString fieldString = "";
		QString valueString = "";
		for (int i = 0; i < fields.length(); i++) {
			QString f = fields[i];
			if (fieldString != "") fieldString += ", ";
			if (valueString != "") valueString += ", ";
			fieldString += f;
			valueString += ":" + f;
		}

		sql = QString("INSERT INTO %1 (%2) VALUES (%3)").arg(tableName).arg(fieldString).arg(valueString);
	} else if (type == Update) {
		QString fieldString = "";
		for (int i = 0; i < fields.length(); i++) {
			QString f = fields[i];
			if (fieldString != "") fieldString += ", ";
			fieldString += f + " = :" + f;
		}

		sql = QString("UPDATE %1 SET %2").arg(tableName).arg(fieldString);
		if (whereCondition != "") sql += " WHERE " + whereCondition;
	}

	QSqlQuery query(db_);
	query.prepare(sql);
	for (int i = 0; i < values.size(); i++) {
		QVariant v = values[i];
		QString fieldName = ":" + fields[i];
		if (v.type() == QVariant::String) {
			query.bindValue(fieldName, v.toString());
		} else if (v.type() == QVariant::Int) {
			query.bindValue(fieldName, v.toInt());
		} else if (v.isNull()) {
			query.bindValue(fieldName, (int)NULL);
		} else if (v.type() == QVariant::Double) {
			query.bindValue(fieldName, v.toDouble());
		} else if (v.type() == (QVariant::Type)QMetaType::Float) {
			query.bindValue(fieldName, v.toFloat());
		} else if (v.type() == QVariant::LongLong) {
			query.bindValue(fieldName, v.toLongLong());
		} else if (v.type() == QVariant::UInt) {
			query.bindValue(fieldName, v.toUInt());
		} else if (v.type() == QVariant::Char) {
			query.bindValue(fieldName, v.toChar());
		} else {
			qWarning() << Q_FUNC_INFO << "Unsupported variant type:" << v.type();
		}
	}

	qDebug() <<"SQL:"<<sql;

	QMapIterator<QString, QVariant> i(query.boundValues());
	while (i.hasNext()) {
		i.next();
		qDebug() << i.key() << ":" << i.value().toString();
	}

	return query;
}

int Database::version() const {
	if (version_ >= 0) return version_;

	QSqlQuery query = db_.exec("SELECT * FROM version");
	bool result = query.next();
	if (!result) return 0;

	QSqlRecord r = query.record();
	int i_version = r.indexOf("version");

	version_ = query.value(i_version).toInt();
	return version_;
}

QStringList Database::sqlStringToLines(const QString& sql) {
	QStringList statements;
	QStringList lines = sql.split("\n");
	QString statement;
	foreach (QString line, lines) {
		line = line.trimmed();
		if (line == "") continue;
		if (line.left(2) == "--") continue;
		statement += line;
		if (line[line.length() - 1] == ';') {
			statements.append(statement);
			statement = "";
		}
	}
	return statements;
}

void Database::upgrade() {
	// INSTRUCTIONS TO UPGRADE THE DATABASE:
	//
	// 1. Add the new version number to the existingDatabaseVersions array
	// 2. Add the upgrade logic to the "switch (targetVersion)" statement below

	QList<int> existingVersions;
	existingVersions << 1;

	int versionIndex = existingVersions.indexOf(version());
	if (versionIndex == existingVersions.length() - 1) return;

	while (versionIndex < existingVersions.length() - 1) {
		int targetVersion = existingVersions[versionIndex + 1];

		qDebug() << "Upgrading database to version " << targetVersion;

		db_.transaction();

		switch (targetVersion) {

		    case 1:

			    QFile f(":/schema.sql");
				if  (!f.open(QFile::ReadOnly | QFile::Text)) {
					qFatal("Cannot open database schema file");
					return;
				}
				QTextStream in(&f);
				QString schemaSql = in.readAll();

				QStringList lines = sqlStringToLines(schemaSql);
				foreach (const QString& line, lines) {
					db_.exec(line);
				}

			break;

		}

		db_.exec(QString("UPDATE version SET version = %1").arg(targetVersion));
		db_.commit();

		versionIndex++;
	}
}
