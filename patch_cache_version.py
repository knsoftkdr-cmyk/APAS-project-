path = "src/hooks/usePermissions.ts"
with open(path) as f:
    c = f.read()

old = 'const CACHE_VERSION = "v9";'
assert old in c, "CACHE_VERSION line not found"
new = 'const CACHE_VERSION = "v10";'
c = c.replace(old, new)

with open(path, "w") as f:
    f.write(c)
print("Bumped CACHE_VERSION to v10")
