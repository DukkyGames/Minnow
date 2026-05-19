# demo.py - A simple Python demo script

# 1. Variables and types
name = "World"
count = 42
pi = 3.14159
is_demo = True

print(f"Hello, {name}!")
print(f"Count: {count}, Pi: {pi}, Is demo: {is_demo}")

# 2. Lists and loops
fruits = ["apple", "banana", "cherry", "date"]
print("\nFruits:")
for i, fruit in enumerate(fruits, 1):
    print(f"  {i}. {fruit}")

# 3. Dictionary
scores = {"Alice": 95, "Bob": 87, "Charlie": 92}
print("\nScores:")
for student, score in scores.items():
    grade = "A" if score >= 90 else "B" if score >= 80 else "C"
    print(f"  {student}: {score} ({grade})")

# 4. List comprehension
squares = [x ** 2 for x in range(1, 11)]
print(f"\nSquares of 1-10: {squares}")

# 5. Exception handling
try:
    result = 10 / 0
except ZeroDivisionError:
    print("\nCaught ZeroDivisionError!")

# 6. Custom function
def greet(person, times=1):
    return "\n".join(f"Hello, {person}!" for _ in range(times))

print(f"\n{greet('Demo', 3)}")

print("\nDemo complete!")
