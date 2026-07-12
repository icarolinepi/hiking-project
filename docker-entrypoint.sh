#!/bin/sh
set -e

echo "Застосовую міграції Prisma..."
npx prisma migrate deploy

echo "Запускаю Стежки..."
exec npx next start -H 0.0.0.0 -p 3000
