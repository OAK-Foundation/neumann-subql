FROM postgres:15

# Install custom Postgres extension
RUN set -xe && \
    apt update && \
    apt install -y postgresql-15-wal2json

# Copy in the load-extensions script and many feature we use down the line
# Most importantly we made use of logical streaming to subscribe to table changes
# Ref:
#  https://hevodata.com/learn/postgresql-logical-replication/
#  https://www.postgresql.org/docs/current/protocol-replication.html
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY init/ /docker-entrypoint-initdb.d/